// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { MessageKind, buildDefaultChatUri } from '../../common/state/sessionState.js';
import { AgentSignal, IAgentActionSignal } from '../../common/agentService.js';
import { ResponsePartKind } from '../../common/state/protocol/state.js';
import type { Turn, Message } from '../../common/state/protocol/state.js';

// ── Interface ────────────────────────────────────────────────────────────────

export interface IOpenCodeSession {
	readonly sessionId: string;
	readonly sessionUri: URI;
	readonly chatChannelUri: URI;
	readonly opencodeSessionId: string | undefined;
	initialize(): Promise<void>;
	sendMessage(prompt: string, turnId?: string, tools?: string[]): Promise<void>;
	abort(): void;
	getMessages(): Promise<readonly Turn[]>;
	respondToPermissionRequest(requestId: string, approved: boolean): void;
	handleEvent(event: import('./openCodeEventStream.js').IOpenCodeEvent): void;
	onConnectionLost(): void;
	dispose(): void;
}

// ── Session ──────────────────────────────────────────────────────────────────

export class OpenCodeSession extends Disposable implements IOpenCodeSession {

	public opencodeSessionId: string | undefined;
	private _abortController: AbortController | undefined;

	constructor(
		public readonly sessionId: string,
		public readonly sessionUri: URI,
		private readonly _baseUrl: string,
		private readonly _authHeader: string,
		private readonly _onProgress: Emitter<AgentSignal>,
		private readonly _logService: ILogService,
	) {
		super();
	}

	get chatChannelUri(): URI {
		return URI.parse(buildDefaultChatUri(this.sessionUri));
	}

	// ── Initialize ─────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		const resp = await this._request<{ id: string }>('POST', '/session/', {});
		this.opencodeSessionId = resp.id;
		this._logService.info(`[OpenCode] session created: ${this.opencodeSessionId}`);
	}

	// ── Send message ──────────────────────────────────────────────────────

	async sendMessage(prompt: string, turnId?: string, tools?: string[]): Promise<void> {
		if (!this.opencodeSessionId) {
			throw new Error('OpenCode session not initialized');
		}

		const effectiveTurnId = turnId ?? generateUuid();
		this._currentTurnId = effectiveTurnId;
		const startedAt = new Date().toISOString();

		const message: Message = {
			text: prompt,
			origin: { kind: MessageKind.User },
		};
		this._fireAction(ActionType.ChatTurnStarted, {
			turnId: effectiveTurnId,
			startedAt,
			message,
		});

		this._abortController = new AbortController();

		const url = `${this._baseUrl}/session/${this.opencodeSessionId}/message`;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this._authHeader) { headers['Authorization'] = this._authHeader; }

		const body: Record<string, unknown> = { parts: [{ type: 'text', text: prompt }] };
		if (tools && tools.length > 0) {
			body.tools = Object.fromEntries(tools.map(t => [t, true]));
		}

		try {
			const resp = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: this._abortController.signal,
			});

			if (!resp.ok) {
				throw new Error(`HTTP ${resp.status}`);
			}

			const reader = resp.body?.getReader();
			if (!reader) { throw new Error('No response body'); }

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (value) { buffer += decoder.decode(value, { stream: true }); }
				this._processStreamingJSON(buffer, effectiveTurnId);
				if (done) { break; }
			}

			this._processFinalResponse(buffer, effectiveTurnId);

		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				this._logService.info(`[OpenCode] turn cancelled: ${effectiveTurnId}`);
				this._resetStreamingState();
				this._fireAction(ActionType.ChatTurnCancelled, {
					turnId: effectiveTurnId,
					duration: 0,
				});
				return;
			}
			this._logService.error(`[OpenCode] sendMessage error: ${err}`);
			this._resetStreamingState();
			this._fireAction(ActionType.ChatError, {
				turnId: effectiveTurnId,
				duration: 0,
				error: {
					errorType: 'unknown',
					message: err instanceof Error ? err.message : String(err),
				},
			});
		} finally {
			this._abortController = undefined;
		}
	}

	// ── Abort ──────────────────────────────────────────────────────────────

	abort(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = undefined;
		}
	}

	// ── Messages ──────────────────────────────────────────────────────────

	async getMessages(): Promise<readonly Turn[]> {
		return [];
	}

	// ── Permissions ────────────────────────────────────────────────────────

	respondToPermissionRequest(_requestId: string, _approved: boolean): void {
		// TODO: call opencode POST /permission/:id/reply
	}

	// ── Connection lost ────────────────────────────────────────────────────

	onConnectionLost(): void {
		this.abort();
	}

	// ── Private streaming helpers ──────────────────────────────────────────

	private _textPartId: string | undefined;
	private _reasoningPartId: string | undefined;
	private _processedTextChars = 0;
	private _processedReasoningChars = 0;
	private _dispatchedToolCallIds = new Set<string>();
	private _completedToolCallIds = new Set<string>();
	private _currentTurnId: string | undefined;
	private _sseActive = false;

	private _processStreamingJSON(buffer: string, turnId: string): void {
		if (this._sseActive) { return; }
		const partRegex = /"type"\s*:\s*"(text|reasoning)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"[^}]*\}/g;
		let match: RegExpExecArray | null;

		while ((match = partRegex.exec(buffer)) !== null) {
			const type = match[1];
			const raw = match[2];
			let text: string;
			try {
				text = JSON.parse('"' + raw + '"') as string;
			} catch {
				continue;
			}

			if (type === 'text') {
				const alreadyProcessed = this._processedTextChars;
				if (text.length > alreadyProcessed) {
					const delta = text.slice(alreadyProcessed);
					this._processedTextChars = text.length;
					if (!this._textPartId) {
						this._textPartId = generateUuid();
						this._fireAction(ActionType.ChatResponsePart, {
							turnId,
							part: { kind: ResponsePartKind.Markdown, id: this._textPartId, content: delta },
						});
					} else {
						this._fireAction(ActionType.ChatDelta, {
							turnId,
							partId: this._textPartId,
							content: delta,
						});
					}
				}
			} else if (type === 'reasoning') {
				const alreadyProcessed = this._processedReasoningChars;
				if (text.length > alreadyProcessed) {
					const delta = text.slice(alreadyProcessed);
					this._processedReasoningChars = text.length;
					if (!this._reasoningPartId) {
						this._reasoningPartId = generateUuid();
					}
					this._fireAction(ActionType.ChatReasoning, {
						turnId,
						partId: this._reasoningPartId,
						content: delta,
					});
				}
			}
		}
	}

	private _processFinalResponse(buffer: string, turnId: string): void {
		try {
			const data = JSON.parse(buffer) as {
				info?: { tokens?: Record<string, number> };
				parts?: Array<Record<string, unknown>>;
			};

			if (data.parts) {
				for (const part of data.parts) {
					if (part.type === 'tool') {
						this._dispatchToolCall(turnId, part);
					} else if (part.type === 'text' && typeof part.text === 'string') {
						this._dispatchRemainingText(turnId, part.text as string);
					} else if (part.type === 'reasoning' && typeof part.text === 'string') {
						this._dispatchRemainingReasoning(turnId, part.text as string);
					}
				}
			}

			if (data.info?.tokens) {
				const tokens = data.info.tokens;
				this._fireAction(ActionType.ChatUsage, {
					turnId,
					usage: {
						totalTokens: tokens.total ?? 0,
						inputTokens: tokens.input ?? 0,
						outputTokens: tokens.output ?? 0,
					},
				});
			}
		} catch {
			this._logService.warn('[OpenCode] failed to parse final response');
		}

		this._fireAction(ActionType.ChatTurnComplete, {
			turnId,
			duration: 0,
		});

		this._resetStreamingState();
	}

	private _dispatchToolCall(turnId: string, part: Record<string, unknown>): void {
		const callID = part.callID as string | undefined;
		const tool = part.tool as string | undefined;
		const state = part.state as Record<string, unknown> | undefined;
		if (!callID || !tool || !state) { return; }

		const status = state.status as string | undefined;
		const title = state.title as string | undefined;

		// Dispatch start (if not already dispatched)
		if (!this._dispatchedToolCallIds.has(callID)) {
			this._dispatchedToolCallIds.add(callID);
			this._fireAction(ActionType.ChatToolCallStart, {
				turnId,
				toolCallId: callID,
				toolName: tool,
				displayName: title ?? tool,
				intention: title ?? tool,
			});
		}

		// Dispatch complete with result
		if ((status === 'completed' || status === 'error') && !this._completedToolCallIds.has(callID)) {
			this._completedToolCallIds.add(callID);
			const output = state.output as string | undefined;
			const error = state.error as string | undefined;
			const success = status === 'completed';
			this._fireAction(ActionType.ChatToolCallComplete, {
				turnId,
				toolCallId: callID,
				result: {
					success,
					pastTenseMessage: success ? (title ?? 'Tool completed') : `Tool failed: ${title ?? 'error'}`,
					content: output ? [{ type: 'text', text: output }] : undefined,
					error: error ? { message: error } : undefined,
				},
			});
		}
	}

	private _dispatchRemainingText(turnId: string, fullText: string): void {
		const alreadyProcessed = this._processedTextChars;
		if (fullText.length > alreadyProcessed) {
			const delta = fullText.slice(alreadyProcessed);
			this._processedTextChars = fullText.length;
			if (!this._textPartId) {
				this._textPartId = generateUuid();
				this._fireAction(ActionType.ChatResponsePart, {
					turnId,
					part: { kind: ResponsePartKind.Markdown, id: this._textPartId, content: delta },
				});
			} else {
				this._fireAction(ActionType.ChatDelta, {
					turnId,
					partId: this._textPartId,
					content: delta,
				});
			}
		}
	}

	private _dispatchRemainingReasoning(turnId: string, fullText: string): void {
		const alreadyProcessed = this._processedReasoningChars;
		if (fullText.length > alreadyProcessed) {
			const delta = fullText.slice(alreadyProcessed);
			this._processedReasoningChars = fullText.length;
			if (!this._reasoningPartId) {
				this._reasoningPartId = generateUuid();
			}
			this._fireAction(ActionType.ChatReasoning, {
				turnId,
				partId: this._reasoningPartId,
				content: delta,
			});
		}
	}

	private _resetStreamingState(): void {
		this._textPartId = undefined;
		this._reasoningPartId = undefined;
		this._processedTextChars = 0;
		this._processedReasoningChars = 0;
		this._dispatchedToolCallIds.clear();
		this._completedToolCallIds.clear();
		this._currentTurnId = undefined;
		this._sseActive = false;
	}

	// ── SSE event handling ─────────────────────────────────────────────────

	handleEvent(event: import('./openCodeEventStream.js').IOpenCodeEvent): void {
		const turnId = this._currentTurnId;
		if (!turnId) { return; }

		const props = event.properties;
		switch (event.type) {
			case 'message.part.updated':
				this._handlePartUpdated(turnId, props);
				break;
			case 'message.part.delta':
				this._handlePartDelta(turnId, props);
				break;
		}
	}

	private _handlePartUpdated(turnId: string, props: Record<string, unknown>): void {
		const part = props.part as Record<string, unknown> | undefined;
		if (!part) { return; }

		const partType = part.type as string | undefined;
		if (partType === 'tool') {
			this._handleToolPartEvent(turnId, part);
		} else if (partType === 'text' && typeof part.text === 'string') {
			// Fallback: if HTTP stream didn't catch this text part, dispatch it
			this._dispatchRemainingText(turnId, part.text as string);
		} else if (partType === 'reasoning' && typeof part.text === 'string') {
			this._dispatchRemainingReasoning(turnId, part.text as string);
		}
	}

	private _handlePartDelta(turnId: string, props: Record<string, unknown>): void {
		this._sseActive = true;
		const partID = props.partID as string | undefined;
		const delta = props.delta as string | undefined;
		if (!partID || !delta) { return; }

		// Delta for text or reasoning field — dispatch as ChatDelta for the part
		if (!this._textPartId) {
			this._textPartId = generateUuid();
			this._fireAction(ActionType.ChatResponsePart, {
				turnId,
				part: { kind: ResponsePartKind.Markdown, id: this._textPartId, content: delta },
			});
		} else {
			this._fireAction(ActionType.ChatDelta, {
				turnId,
				partId: this._textPartId,
				content: delta,
			});
		}
	}

	private _handleToolPartEvent(turnId: string, part: Record<string, unknown>): void {
		this._sseActive = true;
		const callID = part.callID as string | undefined;
		const tool = part.tool as string | undefined;
		const state = part.state as Record<string, unknown> | undefined;
		if (!callID || !tool || !state) { return; }

		const status = state.status as string | undefined;
		const title = state.title as string | undefined;

		// Start (only dispatch once per callID)
		if (!this._dispatchedToolCallIds.has(callID)) {
			this._dispatchedToolCallIds.add(callID);
			this._fireAction(ActionType.ChatToolCallStart, {
				turnId,
				toolCallId: callID,
				toolName: tool,
				displayName: title ?? tool,
				intention: title ?? tool,
			});
		}

		// Complete
		if ((status === 'completed' || status === 'error') && !this._completedToolCallIds.has(callID)) {
			this._completedToolCallIds.add(callID);
			const output = state.output as string | undefined;
			const error = state.error as string | undefined;
			const success = status === 'completed';
			this._fireAction(ActionType.ChatToolCallComplete, {
				turnId,
				toolCallId: callID,
				result: {
					success,
					pastTenseMessage: success ? (title ?? 'Tool completed') : `Tool failed: ${title ?? 'error'}`,
					content: output ? [{ type: 'text', text: output }] : undefined,
					error: error ? { message: error } : undefined,
				},
			});
		}
	}

	private async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const url = `${this._baseUrl}${path}`;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this._authHeader) { headers['Authorization'] = this._authHeader; }

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 120_000);

		try {
			const resp = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});
			if (!resp.ok) {
				const text = await resp.text().catch(() => '');
				throw new Error(`OpenCode ${method} ${path} failed: HTTP ${resp.status} ${text}`);
			}
			return await resp.json() as T;
		} finally {
			clearTimeout(timer);
		}
	}

	// ── Action emission ────────────────────────────────────────────────────

	private _fireAction(type: string, fields: Record<string, unknown>): void {
		const signal: IAgentActionSignal = {
			kind: 'action',
			resource: this.chatChannelUri,
			action: { type, ...fields } as any,
		};
		try { this._onProgress.fire(signal); } catch { /* disposed */ }
	}
}

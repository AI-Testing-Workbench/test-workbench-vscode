/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import { ActionType, type SessionAction, type ChatAction } from '../../common/state/sessionActions.js';
import { MessageKind, buildDefaultChatUri } from '../../common/state/sessionState.js';
import { AgentSignal, IAgentActionSignal, IAgentToolPendingConfirmationSignal } from '../../common/agentService.js';
import { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, MessageAttachmentKind, ResponsePartKind, TurnState, ToolCallStatus, type Turn, type Message, type ResponsePart, type MessageAttachment, type ChatInputAnswer, type ChatInputQuestion, type ChatInputRequest, type ModelSelection, type ToolCallState } from '../../common/state/protocol/state.js';

// ── Interface ────────────────────────────────────────────────────────────────

export interface IOpenCodeSession {
	readonly sessionId: string;
	readonly sessionUri: URI;
	readonly chatChannelUri: URI;
	readonly opencodeSessionId: string | undefined;
	/** 是否有进行中的 turn(HTTP 请求在途),供 releaseSession 判断能否安全释放内存 */
	readonly hasActiveTurn: boolean;
	initialize(): Promise<void>;
	/** 从 fork 的 POST /session/:id/fork 创建新 opencode 会话,返回新会话 id */
	fork(messageID?: string): Promise<string>;
	/** 设置会话模型覆盖(fork 在 POST /session/:id/message 时携带 model) */
	setModel(model: ModelSelection | undefined): void;
	sendMessage(prompt: string, workingDirectory?: URI, attachments?: readonly import('../../common/state/protocol/state.js').MessageAttachment[], turnId?: string, tools?: string[]): Promise<void>;
	abort(): void;
	getMessages(): Promise<readonly Turn[]>;
	respondToPermissionRequest(requestId: string, approved: boolean): void;
	respondToUserInputRequest(requestId: string, response: ChatInputResponseKind, answers?: Record<string, ChatInputAnswer>): void;
	handleEvent(event: import('./openCodeEventStream.js').IOpenCodeEvent): void;
	onConnectionLost(): void;
	dispose(): void;
}

// ── fork 消息结构 ────────────────────────────────────────────────────────────

/** fork `GET /session/:id/message` 返回的消息元信息 */
interface ForkMessageInfo {
	id: string;
	role: 'user' | 'assistant';
	time?: { created?: number };
	text?: string;
	summary?: { title?: string; body?: string };
}

/** fork 消息中的 part(TextPart/ReasoningPart/ToolPart 等的公共字段) */
interface ForkPart {
	id?: string;
	type?: string;
	text?: string;
	callID?: string;
	tool?: string;
	state?: { status?: string; title?: string; output?: string; error?: string };
}

/**
 * 将 fork 的 `{ info, parts }` 消息记录转换为 agent host 协议的 Turn。
 * 用户消息 → Turn.message;助手消息 → Turn.responseParts(text→markdown、reasoning→reasoning)。
 */
function forkMessageToTurn(record: { info: ForkMessageInfo; parts?: ForkPart[] }): Turn {
	const { info, parts = [] } = record;
	const isUser = info.role === 'user';

	// 用户消息的文本来自其 text part(或 info.text)
	const textParts = parts.filter(p => p.type === 'text' && typeof p.text === 'string');
	const text = (isUser ? (info.text ?? '') : '') || textParts.map(p => p.text).join('\n');

	const responseParts: ResponsePart[] = [];
	for (const part of parts) {
		const partId = part.id ?? generateUuid();
		if (part.type === 'text' && typeof part.text === 'string') {
			responseParts.push({ kind: ResponsePartKind.Markdown, id: partId, content: part.text });
		} else if (part.type === 'reasoning' && typeof part.text === 'string') {
			responseParts.push({ kind: ResponsePartKind.Reasoning, id: partId, content: part.text });
		} else if (part.type === 'tool' && part.callID && part.tool) {
			const status = part.state?.status;
			responseParts.push({
				kind: ResponsePartKind.ToolCall,
				// fork 协议字段(title/output)与协议 ToolCallState 不完全一致,需断言 // test-workbench_change
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
				toolCall: {
					toolCallId: part.callID,
					toolName: part.tool,
					status: status === 'completed' ? 'completed' : status === 'error' ? 'error' : 'pending',
					title: part.state?.title,
					output: part.state?.output,
					error: part.state?.error ? { message: part.state.error } : undefined,
				} as unknown as ToolCallState,
			});
		}
	}

	const message: Message = {
		text,
		origin: { kind: isUser ? MessageKind.User : MessageKind.Agent },
	};

	return {
		id: info.id,
		startedAt: info.time?.created ? new Date(info.time.created).toISOString() : undefined,
		message,
		responseParts,
		usage: undefined,
		state: TurnState.Complete,
	};
}

/**
 * 将 fork 的 permission 名称映射为 agent host 的 auto-approval kind。
 * fork 常用值:bash / edit / write / apply_patch / webfetch / read / mcp 等。
 */
function mapForkPermissionKind(permission: string): 'shell' | 'write' | 'mcp' | 'read' | 'url' | 'skill' | 'custom-tool' | 'hook' | 'memory' | undefined {
	switch (permission) {
		case 'bash':
		case 'shell':
		case 'exec':
			return 'shell';
		case 'edit':
		case 'write':
		case 'apply_patch':
			return 'write';
		case 'read':
			return 'read';
		case 'webfetch':
		case 'url':
			return 'url';
		case 'mcp':
			return 'mcp';
		default:
			return undefined;
	}
}

// ── Session ──────────────────────────────────────────────────────────────────

export class OpenCodeSession extends Disposable implements IOpenCodeSession {

	public opencodeSessionId: string | undefined;
	private _abortController: AbortController | undefined;
	private _modelOverride: ModelSelection | undefined;
	// test-workbench_change: 恢复支持 —— 已知的 fork 会话 ID(重挂)+ 新建完成回调(记映射)
	public knownOpencodeSessionId: string | undefined;
	public onSessionCreated: ((opencodeSessionId: string) => void) | undefined;

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

	/** 是否有进行中的 turn(HTTP 请求在途)。供 releaseSession 判断能否安全释放内存。 */
	get hasActiveTurn(): boolean {
		return this._abortController !== undefined;
	}

	// ── Initialize ─────────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		// 恢复路径:orchestrator 预分配了 agent sessionId 且映射文件记录过
		// fork 会话,直接重挂既有会话,历史得以保留。 // test-workbench_change
		if (this.knownOpencodeSessionId) {
			try {
				const info = await this._request<{ id: string }>('GET', `/session/${this.knownOpencodeSessionId}`);
				this.opencodeSessionId = info.id ?? this.knownOpencodeSessionId;
				this._logService.info(`[OpenCode] session restored: ${this.sessionId} -> opencode ${this.opencodeSessionId}`);
				return;
			} catch (err) {
				// 会话已被删除(404 等),回退到新建
				this._logService.info(`[OpenCode] mapped opencode session gone, creating new: ${err}`);
			}
		}
		const resp = await this._request<{ id: string }>('POST', '/session/', {});
		this.opencodeSessionId = resp.id;
		this.onSessionCreated?.(resp.id);
		this._logService.info(`[OpenCode] session created: ${this.sessionId} -> opencode ${this.opencodeSessionId}`);
	}

	// ── Fork ───────────────────────────────────────────────────────────────

	async fork(messageID?: string): Promise<string> {
		if (!this.opencodeSessionId) {
			throw new Error('OpenCode session not initialized');
		}
		const body = messageID ? { messageID } : {};
		const resp = await this._request<{ id: string }>('POST', `/session/${this.opencodeSessionId}/fork`, body);
		this._logService.info(`[OpenCode] session forked: ${this.opencodeSessionId} -> ${resp.id}`);
		return resp.id;
	}

	// ── Model ──────────────────────────────────────────────────────────────

	setModel(model: ModelSelection | undefined): void {
		this._modelOverride = model;
		this._logService.info(`[OpenCode] session model set: ${model?.id ?? '(default)'}`);
	}

	// ── Send message ──────────────────────────────────────────────────────

	async sendMessage(prompt: string, workingDirectory?: URI, attachments?: readonly MessageAttachment[], turnId?: string, tools?: string[]): Promise<void> {
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
		// fork 通过 x-opencode-directory header 定位工作目录(workspace-routing.ts)
		if (workingDirectory) { headers['x-opencode-directory'] = workingDirectory.fsPath; }

		const parts: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
		if (attachments && attachments.length > 0) {
			for (const att of attachments) {
				if (att.type === MessageAttachmentKind.Resource && att.uri) {
					parts.push({ type: 'file', mime: att.contentType ?? 'text/plain', url: att.uri.toString() });
				} else if (att.type === MessageAttachmentKind.EmbeddedResource) {
					parts.push({ type: 'file', mime: att.contentType, url: `data:${att.contentType};base64,${att.data}` });
				}
				// Simple / Annotations 附件暂不映射(无 URI 或为注释通道)
			}
		}

		const body: Record<string, unknown> = { parts };
		if (tools && tools.length > 0) {
			body.tools = Object.fromEntries(tools.map(t => [t, true]));
		}
		// fork 在 POST /session/:id/message 的请求体支持 model: { providerID, modelID }
		if (this._modelOverride) {
			const providerID = this._modelOverride.id.split('/')[0] ?? 'opencode';
			const modelID = this._modelOverride.id.split('/').slice(1).join('/') || this._modelOverride.id;
			body.model = { providerID, modelID };
		}

		try {
			const resp = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: this._abortController.signal,
			});

			if (!resp.ok) {
				const text = await resp.text().catch(() => ''); // 透传服务端错误详情,便于定位 500 根因 // test-workbench_change
				throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 400)}` : ''}`);
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
		if (!this.opencodeSessionId) {
			return [];
		}

		try {
			const records = await this._request<Array<{ info: ForkMessageInfo; parts?: ForkPart[] }>>(
				'GET', `/session/${this.opencodeSessionId}/message`,
			);
			return records.map(forkMessageToTurn);
		} catch (err) {
			this._logService.warn(`[OpenCode] getMessages failed: ${err}`);
			return [];
		}
	}

	// ── Permissions ────────────────────────────────────────────────────────

	respondToPermissionRequest(requestId: string, approved: boolean): void {
		// 调 fork POST /permission/:requestID/reply,approved → 'once',拒绝 → 'reject'
		if (!this.opencodeSessionId) { return; }
		void this._request('POST', `/permission/${requestId}/reply`, {
			reply: approved ? 'once' : 'reject',
		}).catch(err => {
			this._logService.warn(`[OpenCode] permission reply failed: ${err}`);
		});
	}

	respondToUserInputRequest(requestId: string, response: ChatInputResponseKind, answers?: Record<string, ChatInputAnswer>): void {
		if (!this.opencodeSessionId) { return; }

		// decline / cancel → fork question reject 端点
		if (response !== ChatInputResponseKind.Accept) {
			void this._request('POST', `/question/${requestId}/reject`).catch(err => {
				this._logService.warn(`[OpenCode] question reject failed: ${err}`);
			});
			return;
		}

		// 把协议 answers(Record<questionID, ChatInputAnswer>)转为 fork 的 QuestionAnswer[](string[][])
		const forkAnswers: string[][] = answers
			? Object.values(answers).map(a => {
				if (a.state === ChatInputAnswerState.Skipped) {
					return a.freeformValues ?? [];
				}
				const v = a.value;
				switch (v.kind) {
					case ChatInputAnswerValueKind.Text:
					case ChatInputAnswerValueKind.Number:
					case ChatInputAnswerValueKind.Boolean:
						return [String(v.value)];
					case ChatInputAnswerValueKind.Selected:
						return [v.value, ...(v.freeformValues ?? [])];
					case ChatInputAnswerValueKind.SelectedMany:
						return [...v.value, ...(v.freeformValues ?? [])];
				}
			})
			: [];
		void this._request('POST', `/question/${requestId}/reply`, { answers: forkAnswers }).catch(err => {
			this._logService.warn(`[OpenCode] question reply failed: ${err}`);
		});
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
		const props = event.properties;

		// 权限 / 问询事件是会话级事件(不依赖当前 turn,遗留/恢复后的请求也能到达),
		// 必须先于 turnId 早退处理。 // test-workbench_change
		switch (event.type) {
			case 'permission.asked':
				this._handlePermissionAsked(props);
				break;
			case 'question.asked':
				this._handleQuestionAsked(props);
				break;
			case 'permission.replied':
			case 'question.replied':
			case 'question.rejected':
				break;
		}

		// 以下均为 turn 级事件,无当前 turn 时丢弃
		const turnId = this._currentTurnId;
		if (!turnId) { return; }

		switch (event.type) {
			// 完整 part 更新(text/reasoning/tool)
			case 'message.part.updated':
				this._handlePartUpdated(turnId, props);
				break;
			// part 增量(message.part.delta 携带 partID+delta;session.next.text.delta 仅 delta)
			case 'message.part.delta':
			case 'session.next.text.delta':
				this._handlePartDelta(turnId, props);
				break;
			// reasoning 增量
			case 'session.next.reasoning.delta':
				this._handleReasoningDelta(turnId, props);
				break;
			// 工具调用:called → Start;success/failed → Complete
			case 'session.next.tool.called':
			case 'session.next.tool.input.started':
				this._handleToolCalled(turnId, props);
				break;
			case 'session.next.tool.success':
				this._handleToolEnded(turnId, props, true);
				break;
			case 'session.next.tool.failed':
				this._handleToolEnded(turnId, props, false);
				break;
			// 会话错误
			case 'session.error':
				this._handleSessionError(turnId, props);
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

	// ── fork 事件 handler(session.next.* / session.error)──────────────────

	private _handleReasoningDelta(turnId: string, props: Record<string, unknown>): void {
		this._sseActive = true;
		const delta = props.delta as string | undefined;
		if (!delta) { return; }
		if (!this._reasoningPartId) {
			this._reasoningPartId = generateUuid();
		}
		this._fireAction(ActionType.ChatReasoning, {
			turnId,
			partId: this._reasoningPartId,
			content: delta,
		});
	}

	private _handleToolCalled(turnId: string, props: Record<string, unknown>): void {
		this._sseActive = true;
		const callID = props.callID as string | undefined;
		const tool = props.tool as string | undefined;
		if (!callID || !tool) { return; }

		if (!this._dispatchedToolCallIds.has(callID)) {
			this._dispatchedToolCallIds.add(callID);
			this._fireAction(ActionType.ChatToolCallStart, {
				turnId,
				toolCallId: callID,
				toolName: tool,
				displayName: tool,
				intention: tool,
			});
		}
	}

	private _handleToolEnded(turnId: string, props: Record<string, unknown>, success: boolean): void {
		this._sseActive = true;
		const callID = props.callID as string | undefined;
		if (!callID || this._completedToolCallIds.has(callID)) { return; }
		this._completedToolCallIds.add(callID);

		const tool = props.tool as string | undefined;
		const error = props.error as string | undefined;
		const content = props.content as Array<{ type?: string; text?: string }> | undefined;
		const output = content?.filter(c => typeof c.text === 'string').map(c => c.text).join('\n');

		this._fireAction(ActionType.ChatToolCallComplete, {
			turnId,
			toolCallId: callID,
			result: {
				success,
				pastTenseMessage: success ? `${tool ?? 'Tool'} completed` : `Tool failed: ${error ?? 'error'}`,
				content: output ? [{ type: 'text', text: output }] : undefined,
				error: error ? { message: error } : undefined,
			},
		});
	}

	private _handleSessionError(turnId: string, props: Record<string, unknown>): void {
		this._sseActive = true;
		const error = props.error as { message?: string } | string | undefined;
		const message = typeof error === 'string' ? error : error?.message;
		this._fireAction(ActionType.ChatError, {
			turnId,
			duration: 0,
			error: {
				errorType: 'unknown',
				message: message ?? 'OpenCode session error',
			},
		});
	}

	private _handlePermissionAsked(props: Record<string, unknown>): void {
		// fork permission.asked 的 properties 即 PermissionRequest:
		// { id, sessionID, permission, patterns, metadata, always, tool: {messageID, callID} }
		const request = props as {
			id?: string;
			sessionID?: string;
			permission?: string;
			patterns?: string[];
			tool?: { messageID?: string; callID?: string };
		};
		const requestID = request.id;
		const callID = request.tool?.callID;
		const permission = request.permission;
		if (!requestID || !callID || !permission) { return; }

		const signal: IAgentToolPendingConfirmationSignal = {
			kind: 'pending_confirmation',
			chat: this.chatChannelUri,
			state: {
				toolCallId: callID,
				toolName: permission,
				displayName: permission,
				status: ToolCallStatus.PendingConfirmation,
				invocationMessage: `Requesting permission: ${permission}`,
				confirmationTitle: permission,
				editable: false,
			},
			permissionKind: mapForkPermissionKind(permission),
			permissionPath: request.patterns?.[0],
		};
		try { this._onProgress.fire(signal); } catch { /* disposed */ }
	}

	private _handleQuestionAsked(props: Record<string, unknown>): void {
		// fork question.asked 的 properties 即 QuestionRequest:
		// { id, sessionID, questions: [{ question, header, options: [{label, description}], multiple?, custom? }], tool? }
		const request = props as {
			id?: string;
			sessionID?: string;
			questions?: Array<{
				question?: string;
				header?: string;
				options?: Array<{ label?: string; description?: string }>;
				multiple?: boolean;
				custom?: boolean;
			}>;
		};
		const requestID = request.id;
		if (!requestID) { return; }

		const questions: ChatInputQuestion[] = (request.questions ?? []).map((q, i): ChatInputQuestion => {
			const options = (q.options ?? []).map(o => ({
				id: o.label ?? String(i),
				label: o.label ?? '',
				...(o.description ? { description: o.description } : {}),
			}));
			const common = {
				id: `${requestID}-q${i}`,
				// header 是 fork 的短标签(≤30 字符),映射为 UI 标题
				title: q.header,
				message: q.question ?? '',
				required: true,
			};
			if (options.length > 0) {
				// fork 默认允许输入自定义答案(custom 默认 true),映射为 freeform 输入
				return {
					kind: q.multiple ? ChatInputQuestionKind.MultiSelect : ChatInputQuestionKind.SingleSelect,
					options,
					allowFreeformInput: q.custom !== false,
					...common,
				};
			}
			// 无选项 → 纯文本问题
			return {
				kind: ChatInputQuestionKind.Text,
				...common,
			};
		});

		// fork 请求体只有逐题 question/header,整体 message 用第一题的 header 兜底
		const inputRequest: ChatInputRequest = {
			id: requestID,
			...(request.questions?.[0]?.header ? { message: request.questions[0].header } : {}),
			questions,
		};
		this._fireAction(ActionType.ChatInputRequested, { request: inputRequest });
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
			// eslint-disable-next-line local/code-no-dangerous-type-assertions
			action: { type, ...fields } as unknown as SessionAction | ChatAction,
		};
		try { this._onProgress.fire(signal); } catch { /* disposed */ }
	}
}

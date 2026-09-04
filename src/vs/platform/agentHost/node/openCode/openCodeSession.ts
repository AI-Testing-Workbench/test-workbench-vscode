/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import { ActionType, type SessionAction, type ChatAction } from '../../common/state/sessionActions.js';
import { MessageKind, buildDefaultChatUri } from '../../common/state/sessionState.js';
import { AgentSignal, IAgentActionSignal, IAgentToolPendingConfirmationSignal } from '../../common/agentService.js';
import { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, MessageAttachmentKind, ResponsePartKind, TurnState, ToolCallConfirmationReason, ToolCallStatus, type Turn, type Message, type ResponsePart, type MessageAttachment, type ChatInputAnswer, type ChatInputQuestion, type ChatInputRequest, type ModelSelection, type ToolCallState } from '../../common/state/protocol/state.js';

/** 提取 undici fetch 失败的底层原因(如 ECONNRESET/ETIMEDOUT),便于定位 */
function formatFetchError(err: unknown): string {
	if (!(err instanceof Error)) { return ''; }
	const cause = (err as { cause?: unknown }).cause;
	if (!cause) { return ''; }
	const code = (cause as { code?: string; syscall?: string; errno?: string }).code;
	const syscall = (cause as { syscall?: string }).syscall;
	if (code) { return ` (cause: ${syscall ? `${syscall} ` : ''}${code}${typeof cause === 'string' ? ` ${cause}` : ''})`; }
	return ` (cause: ${String(cause)})`;
}

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
	// test-workbench_change: 轮询需要 finish 探测 turn 完成(prompt_async 模式下无阻塞响应可依赖)
	finish?: string;
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

// ── 文件链接 markdown ────────────────────────────────────────────────────────

/** 判断是否为本地绝对路径(posix 或 Windows 盘符,单行)。仅用于启发式
 *  提取 fork 工具 title/input 里的"文件路径",不匹配时回退纯文本显示。 */
function isLikelyAbsolutePath(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length > 1
		&& value.length < 4096
		&& !value.includes('\n')
		&& value.includes('/')
		&& (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value));
}

/** 从工具 input 提取文件路径(path 类字段;input 本身是字符串时即路径候选) */
function extractToolFilePath(input: unknown): string | undefined {
	if (typeof input === 'string') {
		return isLikelyAbsolutePath(input) ? input : undefined;
	}
	if (input && typeof input === 'object') {
		const rec = input as Record<string, unknown>;
		for (const key of ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'filename']) {
			if (isLikelyAbsolutePath(rec[key])) {
				return rec[key];
			}
		}
	}
	return undefined;
}

/**
 * 构造聊天 UI 可点击的文件链接:[basename](file:///abs/path?vscodeLinkType=file)。
 * `vscodeLinkType=file` 是聊天文件 widget 的触发条件(chatInlineAnchorWidget.ts,
 * 打开文件前会剥掉该 query);内置 copilot host 同样用 file:// 链接
 * (见 copilotToolDisplay.ts formatPathAsMarkdownLink)。 // test-workbench_change
 */
function buildFileMarkdownLink(path: string): string {
	const uri = URI.file(path).with({ query: 'vscodeLinkType=file' });
	return `[${basename(uri)}](${uri.toString()})`;
}

// ── 文件链接契约 ─────────────────────────────────────────────────────────────

/**
 * 注入 opencode 的 system prompt(经 fork POST /session/:id/message 的 `system` 字段,
 * 追加到系统提示,零 fork 改动):强制模型把文件引用输出为 [name](/abs/path) markdown
 * 链接。客户端 rewriteAgentHostLinkTarget / parseAbsoluteFileLinkTarget 已能把绝对
 * 路径 href 转成 file:// 链接(含 :line:col → 行号 fragment),渲染后经默认
 * actionHandler(openerService) 可直接点击打开 —— 与内置 copilot host 的
 * COPILOT_AGENT_HOST_FILE_LINK_INSTRUCTIONS 同一契约。 // test-workbench_change
 */
const OPENCODE_FILE_LINK_INSTRUCTIONS = [
	'<file_folder_and_symbol_links>',
	'Always use Markdown links when referring to existing files, folders, or symbols in the workspace. This is very important for helping the user open them.',
	'- File: use the file name as the link text and the absolute filesystem path as the target, for example [foo.ts](/path/to/foo.ts).',
	'- Folder: links to folders are also supported, with an absolute path to the folder as the target, for example [src/](/path/to/src).',
	'- Symbol: link to symbols by using the containing file path with a 1-based line number as the target, for example [myMethod](/path/to/foo.ts:42).',
	'- Use `/` path separators in link targets, including on Windows (`C:/path/to/foo.ts`).',
	'- If a file path has spaces, wrap the target in angle brackets: [foo bar.ts](</path/to/foo bar.ts>).',
	'- Use absolute filesystem paths rather than `file://` URIs.',
	'- Do not provide line ranges.',
	'- Use a markdown link format every time you refer to a file, folder, or symbol, not just the first time.',
	'</file_folder_and_symbol_links>',
].join('\n');

// ── Session ──────────────────────────────────────────────────────────────────

export class OpenCodeSession extends Disposable implements IOpenCodeSession {

	public opencodeSessionId: string | undefined;
	private _abortController: AbortController | undefined;
	private _modelOverride: ModelSelection | undefined;
	// test-workbench_change: 恢复支持 —— 已知的 fork 会话 ID(重挂)+ 新建完成回调(记映射)
	public knownOpencodeSessionId: string | undefined;
	public onSessionCreated: ((opencodeSessionId: string) => void) | undefined;
	// 当前 turn 的完成信号:SSE finish / abort / 请求错误时 resolve,
	// 驱动 _pollTurn 退出(替代原阻塞 HTTP "turn 结束=响应返回" 的语义) // test-workbench_change
	private _resolveTurnFinished: (() => void) | undefined;

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
		// 新 turn 起点:清掉上一 turn 遗留的流式/工具状态(含延迟补发窗口)
		this._resetStreamingState();
		this._currentTurnId = effectiveTurnId;
		this._currentPrompt = prompt;
		this._currentTurnStartMs = Date.now();
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

		// 打字机渲染由 /event SSE 的 message.part.delta / message.part.updated 驱动
		// (openCodeEventStream → handleEvent);prompt_async 端点立即返回,不再阻塞。
		// turn 完成信号由 SSE finish / abort / 请求错误 / 轮询探测驱动
		// (_finishTurn),轮询仅作 SSE 静默时的兜底。 // test-workbench_change
		const turnFinished = new Promise<void>(resolve => { this._resolveTurnFinished = resolve; });
		const httpPromise = this._postMessage(prompt, workingDirectory, attachments, effectiveTurnId, tools);
		const pollPromise = this._pollTurn(effectiveTurnId, turnFinished);

		try {
			await httpPromise;
		} finally {
			// turn 是否结束由 _finishTurn() 决定(SSE finish / abort / 请求错误),
			// 这里不能清 _abortController:prompt_async 立即返回后 turn 仍在进行,
			// hasActiveTurn(_abortController) 需要保持 true 防 releaseSession 误杀。 // test-workbench_change
		}
		await pollPromise.catch(() => { });
	}

	private async _postMessage(prompt: string, workingDirectory?: URI, attachments?: readonly MessageAttachment[], turnId?: string, tools?: string[]): Promise<void> {
		const url = `${this._baseUrl}/session/${this.opencodeSessionId}/prompt_async`;
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
		// 文件链接契约:强制模型输出 [name](/abs/path) 链接,客户端转成可点击文件链接
		body.system = OPENCODE_FILE_LINK_INSTRUCTIONS; // test-workbench_change
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
			// prompt_async 立即返回 NoContent,不做阻塞等待:
			// turn 生命周期由 SSE + 轮询接管,避免阻塞 POST 被 undici 默认
			// 5min headers 超时杀掉长 turn(实测超时中招)。 // test-workbench_change
			const init: RequestInit = {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: this._abortController?.signal,
			};
			const resp = await fetch(url, init);

			if (!resp.ok) {
				const text = await resp.text().catch(() => ''); // 透传服务端错误详情,便于定位 500 根因 // test-workbench_change
				throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 400)}` : ''}`);
			}

		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				this._logService.info(`[OpenCode] turn cancelled: ${turnId}`);
				this._resetStreamingState();
				this._fireAction(ActionType.ChatTurnCancelled, {
					turnId: turnId ?? '',
					duration: 0,
				});
				return;
			}
			this._logService.error(`[OpenCode] sendMessage error: ${err}${formatFetchError(err)}`);
			this._resetStreamingState();
			this._fireAction(ActionType.ChatError, {
				turnId: turnId ?? '',
				duration: 0,
				error: {
					errorType: 'unknown',
					// 带上 undici 底层原因(如 UND_ERR_HEADERS_TIMEOUT / ECONNRESET),便于定位
					message: `${err instanceof Error ? err.message : String(err)}${formatFetchError(err)}`,
				},
			});
		}
	}

	/** 轮询 GET /session/:id/message,把当前 turn 的新 part 增量渲染(工具状态机 + 文本/推理)。
	 *  SSE 正常送达(_sseHeard)后仅空转等 turnFinished;SSE 静默时靠轮询渲染,
	 *  并通过消息列表的最终 finish 探测 turn 完成。 */
	private async _pollTurn(turnId: string, turnFinished: Promise<void>): Promise<void> {
		let finished = false;
		turnFinished.then(() => { finished = true; }).catch(() => { });

		// 首轮先给 SSE 一点时间证明自己(直达事件与 HTTP POST 几乎并行到达)
		for (let i = 0; i < 5 && !finished && !this._sseHeard; i++) {
			await this._sleep(200);
		}

		while (!finished && this.opencodeSessionId) {
			// SSE 已接管增量渲染,轮询只做"保活"等 turn 完成信号
			if (this._sseHeard) { await this._sleep(200); continue; }

			try {
				const records = await this._request<Array<{ info: ForkMessageInfo; parts?: ForkPart[] }>>(
					'GET', `/session/${this.opencodeSessionId}/message?limit=20`,
				);
				// 只渲染当前 turn 开始后创建的 assistant 消息(避免把历史消息重复渲染进当前 turn)
				let turnDone = false;
				for (const msg of records) {
					if (msg.info.role !== 'assistant') { continue; }
					if (msg.info.time?.created !== undefined && msg.info.time.created < this._currentTurnStartMs) { continue; }
					for (const part of msg.parts ?? []) {
						this._renderPart(turnId, part as unknown as Record<string, unknown>);
					}
					// SSE 静默时的完成兜底:assistant 消息出现最终 finish(非 tool-calls/unknown)
					if (msg.info.finish && msg.info.finish !== 'tool-calls' && typeof msg.info.finish === 'string') {
						turnDone = true;
					}
				}
				if (turnDone) {
					this._completeTurn(turnId);
					this._finishTurn();
				}
			} catch { await this._sleep(800); } /* 轮询失败,下轮重试 */
			await this._sleep(800);
		}
	}

	private _sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	// ── Abort ──────────────────────────────────────────────────────────────

	abort(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = undefined;
		}
		// 主动取消:通知 fork 后端终止 agent loop,并立刻结束 turn
		if (this.opencodeSessionId) {
			void this._request<void>('POST', `/session/${this.opencodeSessionId}/abort`, {
				reason: 'user_abort',
			}).catch(() => { /* abort 失败忽略 */ });
		}
		this._resetStreamingState();
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

	private _dispatchedToolCallIds = new Set<string>();
	private _readyToolCallIds = new Set<string>();
	private _completedToolCallIds = new Set<string>();
	private _toolInputs = new Map<string, unknown>();
	private _currentTurnId: string | undefined;
	private _currentTurnStartMs = 0;
	// SSE 已送达事件(收到过 message.part.delta/updated 即认为 SSE 工作,轮询可停)
	private _sseHeard = false;
	// 本 turn 见过的 messageID → role:fork 对用户消息的 part(prompt 原文)也发
	// part 事件,按消息角色过滤,避免用户输入被渲染进响应。
	// 用户消息的 message.updated 先于其 part 事件到达,所以 part 到达时角色已知。 // test-workbench_change
	private _messageRoles = new Map<string, string>();
	// 当前 turn 的 prompt:part 事件缺 messageID 时的兜底过滤(文本全等的 text part 即用户原文)
	private _currentPrompt: string | undefined;
	// 轮询/SSE 共用:按 partID 追踪文本/推理增量与 part 类型
	// (全量 part 与增量 delta 共用一套判重)
	private _partTypes = new Map<string, 'text' | 'reasoning' | 'tool'>();
	private _partText = new Map<string, string>();
	private _partTextSent = new Map<string, number>();
	private _partTextPartId = new Map<string, string>();
	private _partReasoning = new Map<string, string>();
	private _partReasoningSent = new Map<string, number>();
	private _partReasoningPartId = new Map<string, string>();

	/**
	 * 增量推送文本 part:fullText 为当前全量,内部按已发长度切增量。
	 * 兼容 message.part.delta(增量) 与 message.part.updated(全量) 双源。
	 */
	private _emitText(turnId: string, partID: string, fullText: string): void {
		const sent = this._partTextSent.get(partID) ?? 0;
		if (fullText.length <= sent) { return; }
		const delta = fullText.slice(sent);
		this._partTextSent.set(partID, fullText.length);
		let protocolPartId = this._partTextPartId.get(partID);
		if (!protocolPartId) {
			protocolPartId = generateUuid();
			this._partTextPartId.set(partID, protocolPartId);
			this._fireAction(ActionType.ChatResponsePart, {
				turnId,
				part: { kind: ResponsePartKind.Markdown, id: protocolPartId, content: delta },
			});
		} else {
			this._fireAction(ActionType.ChatDelta, {
				turnId,
				partId: protocolPartId,
				content: delta,
			});
		}
	}

	/** 增量推送推理 part(与 _emitText 同构) */
	private _emitReasoning(turnId: string, partID: string, fullText: string): void {
		const sent = this._partReasoningSent.get(partID) ?? 0;
		if (fullText.length <= sent) { return; }
		const delta = fullText.slice(sent);
		this._partReasoningSent.set(partID, fullText.length);
		let protocolPartId = this._partReasoningPartId.get(partID);
		if (!protocolPartId) {
			protocolPartId = generateUuid();
			this._partReasoningPartId.set(partID, protocolPartId);
		}
		this._fireAction(ActionType.ChatReasoning, {
			turnId,
			partId: protocolPartId,
			content: delta,
		});
	}

	/**
	 * 工具调用状态机(message.part.updated 的 tool part 驱动):
	 * Start → Ready(auto-confirm,直接 running) → Complete。
	 * 协议 reducer 要求 Start 后必须先 Ready(confirmed) 才能 Complete,
	 * 否则 Complete 会被忽略、工具卡片停留在 Streaming。
	 * 权限确认由 fork 的 permission.asked 独立通道处理,不在此重复。
	 */
	private _handleToolPart(turnId: string, part: Record<string, unknown>): void {
		const callID = part.callID as string | undefined;
		const tool = part.tool as string | undefined;
		const state = part.state as { status?: string; title?: string; input?: unknown; output?: string; error?: string } | undefined;
		if (!callID || !tool || !state) { return; }

		const status = state.status;
		const title = state.title;

		// 文件类工具(read/write/edit 等):把路径拼进 markdown 文件链接,
		// chat UI 据此渲染可点击文件 widget(对齐 copilot host 行为)。
		// title 本身就是路径时不重复展示;非路径(描述性 title)保持纯文本。 // test-workbench_change
		const filePath = extractToolFilePath(state.input) ?? (isLikelyAbsolutePath(title) ? title : undefined);
		const fileLink = filePath ? buildFileMarkdownLink(filePath) : undefined;
		const fileMessage = fileLink ? (title !== filePath ? `${title ?? tool} ${fileLink}` : fileLink) : undefined;

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

		// Ready:首次必发(确保后续 Complete 有效);input 从无到有/变化时补发更新
		// (轮询场景下 pending 阶段可能尚无 input,之后 running 才带完整参数)
		const input = state.input;
		const lastInput = this._toolInputs.get(callID);
		const inputChanged = input !== undefined && JSON.stringify(input) !== JSON.stringify(lastInput);
		if (!this._readyToolCallIds.has(callID) || inputChanged) {
			this._readyToolCallIds.add(callID);
			if (input !== undefined) { this._toolInputs.set(callID, input); }
			this._fireAction(ActionType.ChatToolCallReady, {
				turnId,
				toolCallId: callID,
				// 带文件链接时必须用 { markdown } 对象形式:StringOrMarkdown 的字符串
				// 形式会被客户端原样当纯文本渲染(方括号会原样显示)
				invocationMessage: fileMessage ? { markdown: fileMessage } : (title ?? `Running ${tool}`),
				...(input !== undefined ? { toolInput: typeof input === 'string' ? input : JSON.stringify(input) } : {}),
				confirmationTitle: tool,
				confirmed: ToolCallConfirmationReason.NotNeeded,
			});
		}

		if ((status === 'completed' || status === 'error') && !this._completedToolCallIds.has(callID)) {
			this._completedToolCallIds.add(callID);
			const output = state.output;
			const error = state.error;
			const success = status === 'completed';
			this._fireAction(ActionType.ChatToolCallComplete, {
				turnId,
				toolCallId: callID,
				result: {
					success,
					pastTenseMessage: success
						? (fileMessage ? { markdown: fileMessage } : (title ?? 'Tool completed'))
						: `Tool failed: ${error ?? 'error'}`,
					content: output ? [{ type: 'text', text: output }] : undefined,
					error: error ? { message: error } : undefined,
				},
			});
		}
	}

	/** 发一次 ChatTurnComplete,按 turn 去重(SSE message.updated 与轮询探测都会到)。 */
	private _completeTurn(turnId: string): void {
		if (this._completedTurnIds.has(turnId)) { return; }
		this._completedTurnIds.add(turnId);
		this._fireAction(ActionType.ChatTurnComplete, { turnId, duration: 0 });
	}

	private _completedTurnIds = new Set<string>();

	/** 结束当前 turn 的等待(SSE finish / abort / 请求错误 / 轮询探测到完成时调用)。 */
	private _finishTurn(): void {
		const resolve = this._resolveTurnFinished;
		this._resolveTurnFinished = undefined;
		// turn 结束:清 abortController 使 hasActiveTurn 归位
		// (prompt_async 下请求本身早已返回,这个信号只标记 turn 生命周期的终点) // test-workbench_change
		this._abortController = undefined;
		resolve?.();
	}

	private _resetStreamingState(): void {
		this._partTypes.clear();
		this._partText.clear();
		this._partTextSent.clear();
		this._partTextPartId.clear();
		this._partReasoning.clear();
		this._partReasoningSent.clear();
		this._partReasoningPartId.clear();
		this._dispatchedToolCallIds.clear();
		this._readyToolCallIds.clear();
		this._completedToolCallIds.clear();
		this._toolInputs.clear();
		this._currentTurnId = undefined;
		this._currentTurnStartMs = 0;
		this._sseHeard = false;
		this._messageRoles.clear();
		this._currentPrompt = undefined;
		this._completedTurnIds.clear();
		// 结束上一个 turn 的等待(新 turn 起点 / abort / 请求错误) // test-workbench_change
		this._finishTurn();
	}

	// ── SSE event handling ─────────────────────────────────────────────────

	handleEvent(event: import('./openCodeEventStream.js').IOpenCodeEvent): void {
		const props = event.properties;

		// 权限 / 问询 / 会话错误是会话级事件(不依赖当前 turn,遗留/恢复后的请求也能到达),
		// 必须先于 turnId 早退处理。 // test-workbench_change
		switch (event.type) {
			case 'permission.asked':
				this._handlePermissionAsked(props);
				return;
			case 'question.asked':
				this._handleQuestionAsked(props);
				return;
			case 'permission.replied':
			case 'question.replied':
			case 'question.rejected':
				return;
			case 'session.error':
				// turn 级错误:无当前 turn 时丢弃
				if (this._currentTurnId) { this._handleSessionError(this._currentTurnId, props); }
				return;
		}

		// 以下均为 turn 级事件,无当前 turn 时丢弃
		const turnId = this._currentTurnId;
		if (!turnId) { return; }

		// 收到任一 turn 级 SSE 事件即标记 SSE 存活,轮询降级为兜底
		this._sseHeard = true;

		switch (event.type) {
			// 完整 part 更新(text/reasoning/tool),实时工具状态机的唯一可靠源
			// (fork 的 message.part.updated 走 SyncEvent,默认发布到 bus,不受
			// OPENCODE_EXPERIMENTAL_EVENT_SYSTEM 开关影响) // test-workbench_change
			case 'message.part.updated':
				this._handlePartUpdated(turnId, props);
				break;
			// part 增量(text/reasoning 实时流),fork 直接 bus.publish(PartDelta)
			case 'message.part.delta':
				this._handlePartDelta(turnId, props);
				break;
			// 消息状态更新(含 turn 完成信号:assistant finish 落地)
			case 'message.updated': {
				const info = props.info as { id?: string; role?: string; finish?: string; tokens?: Record<string, number> } | undefined;
				// 记录每条消息的角色(用户消息的 part 事件到达前,其角色必须已知) // test-workbench_change
				if (info?.id && info?.role) { this._messageRoles.set(info.id, info.role); }
				// 多步 turn 中 finish 会多次落地(中间步是 tool-calls),只认最终态
				if (info?.role !== 'assistant' || !info.finish || info.finish === 'tool-calls' || info.finish === 'unknown') {
					return;
				}
				if (info.tokens) {
					this._fireAction(ActionType.ChatUsage, {
						turnId,
						usage: {
							totalTokens: info.tokens.total ?? 0,
							inputTokens: info.tokens.input ?? 0,
							outputTokens: info.tokens.output ?? 0,
						},
					});
				}
				this._completeTurn(turnId);
				this._finishTurn(); // test-workbench_change: 通知轮询/等待方 turn 已结束
				return;
			}
		}
	}

	private _handlePartUpdated(turnId: string, props: Record<string, unknown>): void {
		const part = props.part as { id?: string; messageID?: string; type?: string; text?: string; callID?: string; tool?: string; state?: Record<string, unknown> } | undefined;
		if (!part) { return; }
		if (this._isForeignPart(part.messageID)) { return; }
		// 兜底:缺 messageID 时,文本与 prompt 全等的 text part 即用户原文
		if (part.type === 'text' && typeof part.text === 'string' && part.text === this._currentPrompt) { return; }
		this._renderPart(turnId, part as unknown as Record<string, unknown>);
	}

	/** fork 对用户消息的 part(prompt 原文)也发 part 事件;只渲染 assistant 消息的 part。
	 *  角色未知(messageID 缺失或事件乱序)时放行,保持旧行为。 */
	private _isForeignPart(messageID: string | undefined): boolean {
		if (!messageID) { return false; }
		const role = this._messageRoles.get(messageID);
		return !!role && role !== 'assistant';
	}

	/**
	 * 渲染单个 part(工具状态机 / 文本 / 推理)。
	 * 轮询(GET /session/:id/message)与 SSE(message.part.updated)共用,
	 * 内部按 partID/callID 判重,幂等可重入。
	 */
	private _renderPart(turnId: string, part: Record<string, unknown>): void {
		const partID = part.id as string | undefined ?? '';
		const partType = part.type as string | undefined;

		if (partType === 'tool') {
			this._partTypes.set(partID, 'tool');
			this._handleToolPart(turnId, part);
		} else if (partType === 'text' && typeof part.text === 'string') {
			this._partTypes.set(partID, 'text');
			this._emitText(turnId, partID, part.text);
		} else if (partType === 'reasoning' && typeof part.text === 'string') {
			this._partTypes.set(partID, 'reasoning');
			this._emitReasoning(turnId, partID, part.text);
		}
	}

	private _handlePartDelta(turnId: string, props: Record<string, unknown>): void {
		// fork PartDelta payload: { sessionID, messageID, partID, field, delta }
		// reasoning 与 text 的 field 均为 "text",靠 partID→type 映射区分
		const partID = props.partID as string | undefined;
		const delta = props.delta as string | undefined;
		if (!partID || !delta) { return; }
		if (this._isForeignPart(props.messageID as string | undefined)) { return; }

		const partType = this._partTypes.get(partID) ?? 'text';
		if (partType === 'reasoning') {
			const acc = (this._partReasoning.get(partID) ?? '') + delta;
			this._partReasoning.set(partID, acc);
			this._emitReasoning(turnId, partID, acc);
		} else {
			const acc = (this._partText.get(partID) ?? '') + delta;
			this._partText.set(partID, acc);
			this._emitText(turnId, partID, acc);
		}
	}

	private _handleSessionError(turnId: string, props: Record<string, unknown>): void {
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

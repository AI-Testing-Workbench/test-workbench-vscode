/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import { ActionType, type SessionAction, type ChatAction } from '../../common/state/sessionActions.js';
import { MessageKind, buildDefaultChatUri, buildSubagentChatUri, createErrorResponsePart, type Customization } from '../../common/state/sessionState.js'; // test-workbench_change
// test-workbench_change start — task 工具 stamp subagent 渲染 meta,触发 host 对未登记子 chat 的有界等待
import { toToolCallMeta } from '../../common/meta/agentToolCallMeta.js';
// test-workbench_change end
import { fetchOpenCodeCustomizations } from './openCodeCustomizations.js'; // test-workbench_change
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

/**
 * 会话级权限规则(opencode `Permission.Rule` 的宿主侧镜像)。
 * 经 `PATCH /session/:id { permission }` 下发,action 为 allow/deny/ask,
 * permission/pattern 支持 `*` 通配。 // test-workbench_change - new type
 */
export interface IOpenCodePermissionRule {
	readonly permission: string;
	readonly pattern: string;
	readonly action: 'allow' | 'deny' | 'ask';
}

export interface IOpenCodeSession {
	readonly sessionId: string;
	readonly sessionUri: URI;
	readonly chatChannelUri: URI;
	readonly opencodeSessionId: string | undefined;
	/** 是否有进行中的 turn(HTTP 请求在途),供 releaseSession 判断能否安全释放内存 */
	readonly hasActiveTurn: boolean;
	/** test-workbench_change — provisional(草稿)占位标志与升级方法,见 OpenCodeSession 实现 */
	isProvisional: boolean;
	materialize(): Promise<void>;
	invalidateCustomizationsCache(): void;
	/** test-workbench_change — turn 结束回调(agent 接线:清单缓存失效+变更广播) */
	onTurnEnd?: () => void;
	initialize(): Promise<void>;
	/** 从 fork 的 POST /session/:id/fork 创建新 opencode 会话,返回新会话 id。
	 *  messageID 允许传 host turn id,内部解析为 fork 锚点消息。 */
	fork(messageID?: string): Promise<string>;
	/** test-workbench_change — 截断后端 transcript:保留至 turnId(含),其后消息删除;undefined 全清 */
	truncate(turnId: string | undefined): Promise<void>;
	/** test-workbench_change — 下发会话级 permission ruleset(PATCH /session/:id) */
	setPermissionRules(ruleset: readonly IOpenCodePermissionRule[]): Promise<void>;
	/** test-workbench_change — 已登记的 subagent 子会话 backing(按 subagent chat URI) */
	getSubagentSession(chat: URI): IOpenCodeSession | undefined;
	/** test-workbench_change — 按 opencode 子会话 id 查找已登记的 subagent backing(SSE 事件路由用) */
	findSubagentByOpencodeId(opencodeSessionId: string): IOpenCodeSession | undefined;
	/** test-workbench_change — 递归 yield 全部后代 subagent backing(应答路由/广播用) */
	iterateSubagentBackings(): Iterable<IOpenCodeSession>;
	/** test-workbench_change — 冷恢复:从父 transcript 中按 task toolCallId 找回子会话并登记 */
	materializeSubagent(chat: URI, toolCallId: string): Promise<IOpenCodeSession | undefined>;
	/** test-workbench_change — dispose subagent backing */
	removeSubagentSession(chat: URI): void;
	/** 设置会话模型覆盖(fork 在 POST /session/:id/message 时携带 model) */
	setModel(model: ModelSelection | undefined): void;
	/** test-workbench_change — 设置工作目录(首条消息携带的真实目录优先) */
	setWorkingDirectory(dir: URI): void;
	/** test-workbench_change — fork 继承语义需要读取源会话的当前目录/模型/agent */
	readonly currentWorkingDirectory: URI | undefined;
	readonly modelOverride: ModelSelection | undefined;
	readonly agentName: string | undefined;
	sendMessage(prompt: string, workingDirectory?: URI, attachments?: readonly import('../../common/state/protocol/state.js').MessageAttachment[], turnId?: string, tools?: string[]): Promise<void>;
	/** test-workbench_change — Try Again:以原 turnId 重发失败的 turn(不新增用户消息) */
	resumeTurn(turnId: string): Promise<void>;
	/** test-workbench_change — 从 fork API 拉取本会话的 skills/commands/agents 清单 */
	getCustomizations(): Promise<readonly Customization[]>;
	/** test-workbench_change — 设置会话 agent(plan/build 等),undefined 回退后端默认 */
	setAgent(name: string | undefined): void;
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
	// test-workbench_change: assistant 实际用的模型(历史 reload 后 footer 模型名来源)
	modelID?: string;
	providerID?: string;
}

/** fork 消息中的 part(TextPart/ReasoningPart/ToolPart 等的公共字段) */
interface ForkPart {
	id?: string;
	type?: string;
	text?: string;
	// test-workbench_change — 文本化 provider(OpenAI chat-completions 等)下,opencode 把工具
	// 调用/结果序列化为 text part 并标记 synthetic:true。非真实对话内容,历史与 live 均须过滤。
	synthetic?: boolean;
	callID?: string;
	tool?: string;
	state?: { status?: string; title?: string; output?: string; error?: string; metadata?: Record<string, unknown> };
}

/**
 * 将 fork 的 `{ info, parts }` 消息记录转换为 agent host 协议的 Turn。
 * 用户消息 → Turn.message;助手消息 → Turn.responseParts(text→markdown、reasoning→reasoning)。
 */
function forkMessageToTurn(record: { info: ForkMessageInfo; parts?: ForkPart[] }): Turn {
	const { info, parts = [] } = record;
	const isUser = info.role === 'user';

	// 用户消息的文本来自其 text part(或 info.text);跳过 synthetic(工具调用/结果的文本化内容) // test-workbench_change
	const textParts = parts.filter(p => p.type === 'text' && typeof p.text === 'string' && !p.synthetic);
	const text = (isUser ? (info.text ?? '') : '') || textParts.map(p => p.text).join('\n');

	const responseParts: ResponsePart[] = [];
	for (const part of parts) {
		const partId = part.id ?? generateUuid();
		if (part.type === 'text' && typeof part.text === 'string' && !part.synthetic) {
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

	// test-workbench_change start — 历史 assistant turn 的 usage.model:reload 后 footer 模型名
	// 来源(与 live ChatUsage.model 同格式 providerID/modelID)。user 消息无模型。
	const usage: Turn['usage'] = isUser || !info.modelID
		? undefined
		: { model: info.providerID ? `${info.providerID}/${info.modelID}` : info.modelID };
	// test-workbench_change end

	return {
		id: info.id,
		startedAt: info.time?.created ? new Date(info.time.created).toISOString() : undefined,
		message,
		responseParts,
		usage,
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
	// test-workbench_change start — customizations discovery:最近一次消息的工作目录 + 60s TTL 缓存
	private _workingDirectory: URI | undefined;
	private _customizationsCache: { at: number; value: readonly Customization[] } | undefined;
	private _agentName: string | undefined;
	// test-workbench_change end
	// test-workbench_change: 恢复支持 —— 已知的 fork 会话 ID(重挂)+ 新建完成回调(记映射)
	public knownOpencodeSessionId: string | undefined;
	// test-workbench_change start — provisional(草稿)会话:orchestrator 预热的 untitled
	// draft 只建内存占位,不 POST /session/;首次 sendMessage 时 materialize() 才真正建会话。
	// 未 materialize 时 opencodeSessionId 为 undefined,所有网络方法已有守卫自然降级。
	public isProvisional = false;
	// test-workbench_change end
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
		// test-workbench_change - 新上游 chat-addressed:signal 需精确寻址 host 指定的 chat
		private readonly _chatChannelUri?: URI,
	) {
		super();
	}

	// test-workbench_change start — subagent 只读 backing 的路由状态(由父在 _registerSubagentSession
	// 注入):_rootChatUri=顶层 chat(remap key),_subagentContext=本 backing 的被 spawn 边
	// (parentChat=顶层 chat + 父 task callID)。普通 backing 二者均 undefined。
	private _rootChatUri: URI | undefined;
	private _subagentContext: { readonly parentChat: URI; readonly toolCallId: string } | undefined;
	// 已发过 model_call_completed 的 opencode assistant 消息 id(去重;每 turn 在 _resetStreamingState 清)
	private _modelCallIdsSeen = new Set<string>();

	setSubagentContext(ctx: { readonly parentChat: URI; readonly toolCallId: string }): void {
		this._subagentContext = ctx;
	}

	/** 子 backing 无 sendMessage 生命周期:激活一个稳定占位 turnId,真实 turn 由 host remap。 */
	activateSubagentTurn(): void {
		if (this._currentTurnId === undefined) { this._currentTurnId = this.sessionId; }
	}

	/** 一次模型响应完成(provider 计时/用量关联)。子会话经 parentToolCallId 走 host remap 到子 chat。 */
	private _fireModelCallCompleted(turnId: string, modelCallId: string): void {
		const ctx = this._subagentContext;
		const signal: AgentSignal = ctx
			? { kind: 'model_call_completed', resource: ctx.parentChat, turnId, modelCallId, parentToolCallId: ctx.toolCallId }
			: { kind: 'model_call_completed', resource: this.chatChannelUri, turnId, modelCallId };
		try { this._onProgress.fire(signal); } catch { /* disposed */ }
	}
	// test-workbench_change end

	get chatChannelUri(): URI {
		return this._chatChannelUri ?? URI.parse(buildDefaultChatUri(this.sessionUri)); // test-workbench_change
	}

	/** 是否有进行中的 turn(HTTP 请求在途)。供 releaseSession 判断能否安全释放内存。 */
	get hasActiveTurn(): boolean {
		return this._abortController !== undefined;
	}

	// ── Initialize ─────────────────────────────────────────────────────────

	/** test-workbench_change — provisional 占位升级为真实会话:首次发送前建 opencode session。
	 *  先清标志再 initialize(initialize 的 provisional 守卫会跳过);失败回滚标志,
	 *  下一条消息自动重试 materialize。 */
	async materialize(): Promise<void> {
		if (!this.isProvisional) { return; }
		this.isProvisional = false;
		try {
			await this.initialize();
		} catch (err) {
			this.isProvisional = true;
			throw err;
		}
	}

	/** test-workbench_change — 失效 customizations 缓存:外部增删源文件后下一次拉清单即重取 */
	invalidateCustomizationsCache(): void { this._customizationsCache = undefined; }

	/** test-workbench_change — turn 结束回调,由 agent 接线(清单变更广播);见 IOpenCodeSession */
	onTurnEnd?: () => void;

	async initialize(): Promise<void> {
		// test-workbench_change — provisional 会话:推迟到 materialize,不立即建后端会话
		if (this.isProvisional) { return; }
		// 恢复路径:orchestrator 预分配了 agent sessionId 且映射文件记录过
		// fork 会话,直接重挂既有会话,历史得以保留。 // test-workbench_change
		if (this.knownOpencodeSessionId) {
			try {
				const info = await this._request<{ id: string }>('GET', `/session/${this.knownOpencodeSessionId}`);
				this.opencodeSessionId = info.id ?? this.knownOpencodeSessionId;
				this._logService.info(`[TestAgent] session restored: ${this.sessionId} -> opencode ${this.opencodeSessionId}`);
				return;
			} catch (err) {
				// 会话已被删除(404 等),回退到新建
				this._logService.info(`[TestAgent] mapped backend session gone, creating new: ${err}`);
			}
		}
		const initStart = Date.now(); // test-workbench_change — 耗时埋点
		const resp = await this._request<{ id: string }>('POST', '/session/', {});
		this.opencodeSessionId = resp.id;
		this.onSessionCreated?.(resp.id);
		this._logService.info(`[耗时][会话建立] POST /session/(创建 opencode 后端会话)= ${Date.now() - initStart}ms;时间消耗类型 =「testagent 进程内会话初始化 HTTP 往返」`); // test-workbench_change
		this._logService.info(`[TestAgent] session created: ${this.sessionId} -> backend ${this.opencodeSessionId}`);
	}

	// ── Fork ───────────────────────────────────────────────────────────────

	async fork(messageID?: string): Promise<string> {
		if (!this.opencodeSessionId) {
			throw new Error('TestAgent session not initialized');
		}
		// test-workbench_change start — host 的 fork turnId 是 VS Code turn id(live)或
		// opencode message id(restore),先翻译为本轮最后一条后端消息;后端复制边界是
		// exclusive(`id >= messageID` 即 break),上游 "up to and including" 语义要求
		// 传锚点的【下一条】消息 id 作 boundary;锚点为末条时省略 = 整会话 fork。
		const anchor = messageID ? (this._hostTurnAnchors.get(messageID) ?? messageID) : undefined;
		let boundary: string | undefined;
		if (anchor) {
			const records = await this._request<Array<{ info: ForkMessageInfo }>>(
				'GET', `/session/${this.opencodeSessionId}/message`,
			);
			const idx = records.findIndex(r => r.info.id === anchor);
			if (idx === -1) {
				this._logService.warn(`[TestAgent] fork: anchor ${anchor} not found in ${this.opencodeSessionId}; forking whole session`);
			} else if (idx < records.length - 1) {
				boundary = records[idx + 1].info.id;
			}
		}
		const body = boundary ? { messageID: boundary } : {};
		// test-workbench_change end
		const resp = await this._request<{ id: string }>('POST', `/session/${this.opencodeSessionId}/fork`, body);
		this._logService.info(`[TestAgent] session forked: ${this.opencodeSessionId} -> ${resp.id}${anchor ? ` (up to ${anchor})` : ''}`);
		return resp.id;
	}

	// ── Model ──────────────────────────────────────────────────────────────

	setModel(model: ModelSelection | undefined): void {
		this._modelOverride = model;
		this._logService.info(`[TestAgent] session model set: ${model?.id ?? '(default)'}`);
	}

	// ── Send message ──────────────────────────────────────────────────────

	async sendMessage(prompt: string, workingDirectory?: URI, attachments?: readonly MessageAttachment[], turnId?: string, tools?: string[]): Promise<void> {
		if (!this.opencodeSessionId) {
			throw new Error('TestAgent session not initialized');
		}

		const effectiveTurnId = turnId ?? generateUuid();
		// 新 turn 起点:清掉上一 turn 遗留的流式/工具状态(含延迟补发窗口)
		this._resetStreamingState();
		this._currentTurnId = effectiveTurnId;
		this._currentPrompt = prompt;
		this._lastSend = { prompt, workingDirectory, attachments, tools }; // test-workbench_change: resumeTurn 重发用
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
		// test-workbench_change start — 耗时埋点:轮次起点(t0),此后各 [耗时] 日志以此为基准
		this._logService.info(`[耗时][轮次起点] TestAgent 本轮开始(turnId=${effectiveTurnId.slice(0, 8)},backend会话=${this.opencodeSessionId});时间消耗类型 =「用户消息已进入 provider,以下均距此计时」`);
		// test-workbench_change end

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

	// test-workbench_change start — slash 命令支持:CLI 里 `/xxx` 由 TUI 解析,HTTP 侧对应
	// POST /session/:id/command(fork 的 skills 已合并进命令列表,GET /command 可见 source:"skill")。
	private static _parseSlashCommand(text: string): { name: string; args: string } | undefined {
		const m = /^\/([\w:.\-]+)(?:[ \t]+([\s\S]*))?$/.exec(text.trim());
		return m ? { name: m[1], args: m[2] ?? '' } : undefined;
	}

	private _commandNames: Set<string> | undefined;

	private async _getCommandNames(workingDirectory?: URI): Promise<Set<string>> {
		if (this._commandNames) { return this._commandNames; }
		const headers: Record<string, string> = {};
		if (this._authHeader) { headers['Authorization'] = this._authHeader; }
		if (workingDirectory) { headers['x-opencode-directory'] = encodeURIComponent(workingDirectory.fsPath); }
		const cmdListStart = Date.now(); // test-workbench_change — 耗时埋点
		try {
			const resp = await fetch(`${this._baseUrl}/command`, { headers });
			if (!resp.ok) { return new Set(); } // 失败不缓存,下条消息重试
			const list = await resp.json() as Array<{ name?: string }>;
			this._commandNames = new Set(list.map(c => c.name).filter((n): n is string => !!n));
			this._logService.info(`[耗时][命令清单] GET /command(slash 命令表拉取,仅首条 slash 查询时阻塞发送一次)= ${Date.now() - cmdListStart}ms;时间消耗类型 =「清单 HTTP 往返,60s 内不再发生(缓存至本进程生命周期)」`); // test-workbench_change
			return this._commandNames;
		} catch { return new Set(); }
	}
	// test-workbench_change end

	// test-workbench_change start — Customizations 面板数据源:pull 模型,fork API 清单 60s TTL
	setWorkingDirectory(dir: URI): void {
		const first = this._workingDirectory === undefined;
		this._workingDirectory ??= dir; // 首条消息携带的真实目录优先
		// test-workbench_change — 冷恢复时子 backing 可能先于父目录落地(registered via
		// materializeSubagent),首次设目录时级联给已登记的子会话,保证其应答请求带路由头。
		if (first) { for (const [, child] of this._subagentSessions) { child.setWorkingDirectory(dir); } }
	}

	/** 当前生效工作目录(fork 继承 / HTTP 路由头用) */
	get currentWorkingDirectory(): URI | undefined { return this._workingDirectory; }
	/** 当前模型覆盖(fork 继承用) */
	get modelOverride(): ModelSelection | undefined { return this._modelOverride; }
	/** 当前 agent 名(fork 继承用) */
	get agentName(): string | undefined { return this._agentName; }
	// test-workbench_change end

	setAgent(name: string | undefined): void { this._agentName = name; } // test-workbench_change

	async getCustomizations(): Promise<readonly Customization[]> {
		const cached = this._customizationsCache;
		if (cached && Date.now() - cached.at < 60_000) { return cached.value; }
		const value = await fetchOpenCodeCustomizations(this._baseUrl, this._authHeader, this._workingDirectory, this._logService);
		if (value.length) { this._customizationsCache = { at: Date.now(), value }; }
		return value;
	}
	// test-workbench_change end

	private async _postMessage(prompt: string, workingDirectory?: URI, attachments?: readonly MessageAttachment[], turnId?: string, tools?: string[]): Promise<void> {
		if (workingDirectory) { this._workingDirectory = workingDirectory; } // test-workbench_change
		const url = `${this._baseUrl}/session/${this.opencodeSessionId}/prompt_async`;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this._authHeader) { headers['Authorization'] = this._authHeader; }
		// fork 通过 x-opencode-directory header 定位工作目录(workspace-routing.ts)
		// test-workbench_change: header 值只允许 Latin-1(undici ByteString)，中文路径必须 percent-encode，服务端对应 decode
		if (workingDirectory) { headers['x-opencode-directory'] = encodeURIComponent(workingDirectory.fsPath); }

		// test-workbench_change start — 纯文本 `/name args` 且命中 fork 命令表时走 command 端点。
		// 该端点响应要等整轮完成,故后台发送不 await;turn 生命周期照旧由 SSE + 轮询接管。
		const slash = (!attachments || attachments.length === 0) ? OpenCodeSession._parseSlashCommand(prompt) : undefined;
		if (slash && (await this._getCommandNames(workingDirectory)).has(slash.name)) {
			const cmdBody: Record<string, unknown> = { command: slash.name, arguments: slash.args };
			if (this._modelOverride) { cmdBody.model = this._modelOverride.id; }
			if (this._agentName) { cmdBody.agent = this._agentName; } // test-workbench_change
			const cmdStart = Date.now(); // test-workbench_change — 耗时埋点
			fetch(`${this._baseUrl}/session/${this.opencodeSessionId}/command`, {
				method: 'POST',
				headers,
				body: JSON.stringify(cmdBody),
				signal: this._abortController?.signal,
			}).then(async r => {
				if (!r.ok) { throw new Error(`HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 400)}`); }
				// test-workbench_change start — 耗时埋点:command 端点整轮完成才返回,此值≈后端视角整轮耗时
				this._logService.info(`[耗时][slash轮次] POST /session/:id/command 响应到达 = ${Date.now() - cmdStart}ms(距轮次起点 ${Date.now() - this._currentTurnStartMs}ms);时间消耗类型 =「testagent 内整轮执行:模型调用+工具循环+provider 网络,全部发生在宿主进程外」`);
				// test-workbench_change end
			}).catch(err => {
				if (err instanceof Error && err.name !== 'AbortError') { this._logService.error(`[TestAgent] command /${slash.name} failed: ${err}`); }
			});
			return;
		}
		// test-workbench_change end

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
		if (this._agentName) { body.agent = this._agentName; } // test-workbench_change — plan/build 选择透传给 fork(PromptInput.agent)

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
			const postStart = Date.now(); // test-workbench_change — 耗时埋点
			const resp = await fetch(url, init);
			// test-workbench_change start — 耗时埋点:prompt_async 立即返回(204),不含模型执行
			this._logService.info(`[耗时][投递HTTP] POST /prompt_async 往返 = ${Date.now() - postStart}ms(距轮次起点 ${Date.now() - this._currentTurnStartMs}ms);时间消耗类型 =「localhost loopback HTTP,请求已交给 testagent,模型执行从此不计入本值」`);
			// test-workbench_change end

			if (!resp.ok) {
				const text = await resp.text().catch(() => ''); // 透传服务端错误详情,便于定位 500 根因 // test-workbench_change
				throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 400)}` : ''}`);
			}

		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				this._logService.info(`[TestAgent] turn cancelled: ${turnId}`);
				this._resetStreamingState();
				this._fireAction(ActionType.ChatTurnCancelled, {
					turnId: turnId ?? '',
					duration: 0,
				});
				return;
			}
			this._logService.error(`[TestAgent] sendMessage error: ${err}${formatFetchError(err)} (距轮次起点 ${this._currentTurnStartMs ? Date.now() - this._currentTurnStartMs : 0}ms)`); // test-workbench_change — 耗时埋点
			this._resetStreamingState();
			// test-workbench_change start: ChatError 协议字段是 part: ErrorResponsePart(此前误用顶层
			// error,消息被 AgentSideEffects 吞掉)。网络/HTTP 错误可由用户 Try Again 恢复 → resumable=true。
			this._resumableTurnId = turnId;
			this._fireAction(ActionType.ChatError, {
				turnId: turnId ?? '',
				duration: 0,
				part: createErrorResponsePart({
					errorType: 'unknown',
					// 带上 undici 底层原因(如 UND_ERR_HEADERS_TIMEOUT / ECONNRESET),便于定位
					message: `${err instanceof Error ? err.message : String(err)}${formatFetchError(err)}`,
				}, true),
			});
			// test-workbench_change end
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

			// test-workbench_change start — 耗时埋点:SSE 静默,渲染退化到轮询兜底
			if (!this._pollFallbackLogged) {
				this._pollFallbackLogged = true;
				this._logService.info(`[耗时][轮询兜底] SSE 静默(重连中或后端未推送),本 turn 渲染改由 GET /session/:id/message 轮询驱动(首轮等 5×200ms 宽限,之后每轮约 800ms);时间消耗类型 =「兜底路径,首段可见文本最多比 SSE 路径晚 ~1-2s」`);
			}
			// test-workbench_change end
			try {
				const records = await this._request<Array<{ info: ForkMessageInfo; parts?: ForkPart[] }>>(
					'GET', `/session/${this.opencodeSessionId}/message?limit=20`,
				);
				// 只渲染当前 turn 开始后创建的 assistant 消息(避免把历史消息重复渲染进当前 turn)
				let turnDone = false;
				for (const msg of records) {
					if (msg.info.role !== 'assistant') { continue; }
					if (msg.info.time?.created !== undefined && msg.info.time.created < this._currentTurnStartMs) { continue; }
					// SSE 静默时轮询也要登记锚点,否则 fork/truncate 无从翻译 // test-workbench_change
					this._hostTurnAnchors.set(turnId, msg.info.id);
					for (const part of msg.parts ?? []) {
						this._renderPart(turnId, part as unknown as Record<string, unknown>);
					}
					// SSE 静默时的完成兜底:assistant 消息出现最终 finish(非 tool-calls/unknown)
					if (msg.info.finish && msg.info.finish !== 'tool-calls' && typeof msg.info.finish === 'string') {
						turnDone = true;
					}
				}
				if (turnDone) {
					// test-workbench_change start — 耗时埋点:轮询探测到完成的轮次总时长
					this._logService.info(`[耗时][轮次总计-轮询] 轮询兜底探测到 assistant finish = 距轮次起点 ${Date.now() - this._currentTurnStartMs}ms;时间消耗类型 =「整轮耗时(轮询路径,完成判定有最多 ~800ms 探测滞后)」`);
					// test-workbench_change end
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
			this._logService.warn(`[TestAgent] getMessages failed: ${err}`);
			return [];
		}
	}

	// ── Truncation / permission rules ─────────────────────────────────────

	/**
	 * 截断后端 transcript,与 host 已应用的 ChatTruncated 状态对齐:
	 * 保留 [0..turnId](含该 turn 的锚点消息),删除其后所有消息。
	 * `turnId === undefined` 对应 "全部清除/start over"。
	 * 消息删除不回滚文件(host 侧已 discardChatTurnStartCheckpoints),
	 * 与 Codex thread/rollback / Claude resumeSessionAt 的截断语义一致。 // test-workbench_change
	 */
	async truncate(turnId: string | undefined): Promise<void> {
		if (!this.opencodeSessionId) { return; }
		let records: Array<{ info: ForkMessageInfo }>;
		try {
			records = await this._request<Array<{ info: ForkMessageInfo }>>(
				'GET', `/session/${this.opencodeSessionId}/message`,
			);
		} catch (err) {
			this._logService.warn(`[TestAgent] truncate: message list failed: ${err}`);
			return;
		}
		const anchorId = turnId !== undefined
			? (this._hostTurnAnchors.get(turnId) ?? turnId)
			: undefined;
		let anchorIdx = -1;
		if (anchorId !== undefined) {
			records.forEach((r, i) => { if (r.info.id === anchorId) { anchorIdx = i; } });
			if (anchorIdx === -1) {
				this._logService.warn(`[TestAgent] truncateChat: turn ${turnId} not found in session ${this.opencodeSessionId}; skipping`);
				return;
			}
		}
		const doomed = records.slice(anchorIdx + 1);
		for (const rec of doomed) {
			try {
				await this._request<boolean>('DELETE', `/session/${this.opencodeSessionId}/message/${rec.info.id}`);
			} catch (err) {
				this._logService.warn(`[TestAgent] truncate: delete ${rec.info.id} failed: ${err}`);
			}
		}
		// 被删消息的锚点映射失效,清掉;幸存 turn 的映射保留(还可能再次截断)
		if (doomed.length > 0) {
			const doomedIds = new Set(doomed.map(r => r.info.id));
			for (const [hostTurn, anchor] of this._hostTurnAnchors) {
				if (doomedIds.has(anchor)) { this._hostTurnAnchors.delete(hostTurn); }
			}
		}
		this._logService.info(`[TestAgent] truncated session ${this.opencodeSessionId}: removed ${doomed.length} message(s) after ${anchorId ?? '(start)'}`);
	}

	/** 下发会话级 permission ruleset;ruleset 为空数组时恢复后端自身配置 */
	async setPermissionRules(ruleset: readonly IOpenCodePermissionRule[]): Promise<void> {
		if (!this.opencodeSessionId) { return; }
		try {
			await this._request<unknown>('PATCH', `/session/${this.opencodeSessionId}`, { permission: [...ruleset] });
			this._logService.info(`[TestAgent] session ${this.opencodeSessionId} permission rules updated (${ruleset.length} rule(s))`);
		} catch (err) {
			this._logService.warn(`[TestAgent] setPermissionRules failed: ${err}`);
		}
	}

	// ── Subagent backings ─────────────────────────────────────────────────

	/**
	 * 登记 opencode `task` 工具派生的子会话:一个以 buildSubagentChatUri 寻址的
	 * 只读 backing(历史经子会话自身的 GET /session/:id/message)。live spawn 与
	 * 冷恢复(materializeSubagent)共用。随父 session dispose。 // test-workbench_change
	 */
	private _registerSubagentSession(toolCallId: string, childOpencodeId: string): OpenCodeSession {
		const subChat = buildSubagentChatUri(this.sessionUri, toolCallId);
		const existing = this._subagentSessions.get(subChat);
		if (existing) { return existing; }
		const child = new OpenCodeSession(
			this.sessionId + '-subagent-' + toolCallId.slice(0, 12),
			this.sessionUri,
			this._baseUrl, this._authHeader,
			this._onProgress, this._logService,
			URI.parse(subChat), // test-workbench_change — signal 寻址到 subagent chat
		);
		// test-workbench_change start — 根 chat 逐层继承:嵌套 subagent 的 spawn 信号与 action
		// remap 必须以顶层 chat 为 key(host 的 _subagentChats 第一层 key 即 subagent_started
		// 的 chat)。单层时 root=父 chatChannelUri,与旧行为一致。
		const rootChat = this._rootChatUri ?? this.chatChannelUri;
		child._rootChatUri = rootChat;
		child.setSubagentContext({ parentChat: rootChat, toolCallId });
		child.opencodeSessionId = childOpencodeId;
		// test-workbench_change start — 继承父 backing 的工作目录:子会话内 question/permission 的
		// 应答 POST(/question/:id/reply 等)经 _request 必须带 x-opencode-directory 头;
		// 子 backing 此前从未被 setWorkingDirectory(host 只对 default chat 调用),头缺失时
		// fork 的 workspace-routing 落到 server cwd 实例,该实例的 Question pending map 未命中
		// → 404 NotFoundError → 应答永远送不回提问实例 → 子会话「Running question」永久卡死。
		if (this._workingDirectory) { child.setWorkingDirectory(this._workingDirectory); }
		// test-workbench_change end
		// 子 backing 不调 sendMessage,_currentTurnId 恒空会让 handleEvent 早退丢弃所有
		// turn 级事件。给一个稳定占位 turnId:子 backing 的 action 经 parentToolCallId 走
		// host remap 路径,占位值会被替换成子 chat 的真实 active turnId。
		child.activateSubagentTurn();
		// test-workbench_change end
		this._subagentSessions.set(subChat, child);
		this._logService.info(`[TestAgent] subagent backing registered: ${subChat} (backend: ${childOpencodeId})`);
		return child;
	}

	getSubagentSession(chat: URI): IOpenCodeSession | undefined {
		return this._subagentSessions.get(chat.toString());
	}

	// test-workbench_change start — SSE 事件按 opencode 子会话 id 路由到已登记的 subagent backing。
	// 递归:嵌套 subagent 的孙 backing 挂在子 backing 的 _subagentSessions 下。
	findSubagentByOpencodeId(opencodeSessionId: string): IOpenCodeSession | undefined {
		for (const [, s] of this._subagentSessions) {
			if (s.opencodeSessionId === opencodeSessionId) { return s; }
			const nested = s.findSubagentByOpencodeId(opencodeSessionId);
			if (nested) { return nested; }
		}
		return undefined;
	}

	// test-workbench_change start — 递归遍历全部后代 subagent backing。permission/question 的
	// 应答在 agent 层按 requestId 广播,但子 backing 不在顶层 _sessions 里;不展开后代,
	// 子会话内工具的用户应答(批准/回答 question)永远传不回 opencode 后端 → 子会话卡死。
	*iterateSubagentBackings(): Iterable<IOpenCodeSession> {
		for (const [, child] of this._subagentSessions) {
			yield child;
			yield* child.iterateSubagentBackings();
		}
	}
	// test-workbench_change end
	// test-workbench_change end

	/** 冷恢复:host 重订阅 subagent chat 时,从父 transcript 找回 task call 的子会话 id 并重挂。 */
	async materializeSubagent(chat: URI, toolCallId: string): Promise<IOpenCodeSession | undefined> {
		const existing = this._subagentSessions.get(chat.toString());
		if (existing) { return existing; }
		if (!this.opencodeSessionId) { return undefined; }
		let records: Array<{ info: ForkMessageInfo; parts?: ForkPart[] }>;
		try {
			records = await this._request<Array<{ info: ForkMessageInfo; parts?: ForkPart[] }>>(
				'GET', `/session/${this.opencodeSessionId}/message`,
			);
		} catch (err) {
			this._logService.warn(`[TestAgent] materializeSubagent: parent transcript read failed: ${err}`);
			return undefined;
		}
		for (const rec of records) {
			for (const part of rec.parts ?? []) {
				if (part.type === 'tool' && part.tool === 'task' && part.callID === toolCallId) {
					const childId = part.state?.metadata?.sessionId;
					if (typeof childId === 'string') {
						return this._registerSubagentSession(toolCallId, childId);
					}
				}
			}
		}
		this._logService.warn(`[TestAgent] materializeSubagent: no task backing for ${toolCallId}`);
		return undefined;
	}

	removeSubagentSession(chat: URI): void {
		this._subagentSessions.deleteAndDispose(chat.toString());
	}

	// ── Permissions ────────────────────────────────────────────────────────

	respondToPermissionRequest(requestId: string, approved: boolean): void {
		// test-workbench_change start — host 确认链(ChatToolCallConfirmed)传的是 toolCallId(call_),
		// 而 owner 登记与 fork 路由键都是权限请求 id(per_):先翻译回 per_ id,否则
		// _pendingAskIds.delete 永不命中 → POST 从不发出 → fork deferred 永挂
		// (external_directory「Requesting permission」卡死且应答无效的根因)。
		const permissionId = this._permissionIdsByCallId.get(requestId) ?? requestId;
		this._permissionIdsByCallId.delete(requestId);
		if (!this._pendingAskIds.delete(permissionId)) { return; }
		if (!this.opencodeSessionId) { return; }
		// test-workbench_change end
		void this._request('POST', `/permission/${permissionId}/reply`, {
			reply: approved ? 'once' : 'reject',
		}).catch(err => {
			this._logService.warn(`[TestAgent] permission reply failed: ${err}`);
		});
	}

	respondToUserInputRequest(requestId: string, response: ChatInputResponseKind, answers?: Record<string, ChatInputAnswer>): void {
		// test-workbench_change start — 定向化:owner 匹配才发送(见 respondToPermissionRequest)
		if (!this._pendingAskIds.delete(requestId)) { return; }
		if (!this.opencodeSessionId) { return; }
		// test-workbench_change end

		// decline / cancel → fork question reject 端点
		if (response !== ChatInputResponseKind.Accept) {
			void this._request('POST', `/question/${requestId}/reject`).catch(err => {
				this._logService.warn(`[TestAgent] question reject failed: ${err}`);
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
			this._logService.warn(`[TestAgent] question reply failed: ${err}`);
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
	// test-workbench_change start — 耗时埋点日志的去重标志(每 turn 在 _resetStreamingState 复位)
	private _sseFirstEventLogged = false;    // 首个 SSE turn 级事件(≈LLM 首输出回传)
	private _firstTextLogged = false;        // 首段可见文本增量发往 host
	private _firstReasoningLogged = false;   // 首段推理增量发往 host
	private _pollFallbackLogged = false;     // SSE 静默 → 轮询兜底提示
	private _turnFinishLogged = false;       // 轮次总计(多 finish 去重)
	// test-workbench_change end
	// 本 turn 见过的 messageID → role:fork 对用户消息的 part(prompt 原文)也发
	// part 事件,按消息角色过滤,避免用户输入被渲染进响应。
	// 用户消息的 message.updated 先于其 part 事件到达,所以 part 到达时角色已知。 // test-workbench_change
	private _messageRoles = new Map<string, string>();
	// 当前 turn 的 prompt:part 事件缺 messageID 时的兜底过滤(文本全等的 text part 即用户原文)
	private _currentPrompt: string | undefined;
	// test-workbench_change start — Try Again:最近一次发送参数 + 失败 turnId(重发后清除)
	private _lastSend: { prompt: string; workingDirectory?: URI; attachments?: readonly MessageAttachment[]; tools?: string[] } | undefined;
	private _resumableTurnId: string | undefined;
	// test-workbench_change end
	// test-workbench_change start — host turnId → 本轮最后见到的 opencode 消息 id(锚点)。
	// live turn 的 host turnId 是 orchestrator mint 的 uuid,getMessages 返回的
	// Turn.id 是 opencode message id;fork 定位与 truncate 都以该映射翻译,
	// restore 场景下映射缺失时按 id 原样兜底(与 Codex 的 codexTurnIdByHostTurnId 同构)。
	private _hostTurnAnchors = new Map<string, string>();
	// pending ask id → 类型:agent 级 respond 广播时,只有 owner session 真正发 reply
	private _pendingAskIds = new Map<string, 'permission' | 'question'>();
	// permission.asked 的 toolCallId(call_) → 权限请求 id(per_):host 应答只带 toolCallId,
	// 需翻译回 per_ 才能命中 owner 登记并拼出正确的 POST 路径 // test-workbench_change
	private _permissionIdsByCallId = new Map<string, string>();
	// subagent(chat URI → 子会话 backing)与已发出 spawn 事件的 task callID
	private readonly _subagentSessions = this._register(new DisposableMap<string, OpenCodeSession>());
	private _spawnedSubagentCallIds = new Set<string>();
	// 已发出 subagent_completed 的 task callID(去重,防重复关闭子 turn) // test-workbench_change
	private _completedSubagentCallIds = new Set<string>();
	// test-workbench_change end
	// 轮询/SSE 共用:按 partID 追踪文本/推理增量与 part 类型
	// (全量 part 与增量 delta 共用一套判重)
	private _partTypes = new Map<string, 'text' | 'reasoning' | 'tool'>();
	private _partText = new Map<string, string>();
	// test-workbench_change — synthetic text part(文本化工具调用/结果)的 partID,turn 内跳过渲染
	private _syntheticPartIds = new Set<string>();
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
			// test-workbench_change start — 耗时埋点:首段可见文本发往编排层(此后经 reducer+IPC 回 UI)
			if (!this._firstTextLogged && this._currentTurnStartMs) {
				this._firstTextLogged = true;
				this._logService.info(`[耗时][首段文本] 轮次起点→首段可见 Markdown 增量发往 host 编排层 = ${Date.now() - this._currentTurnStartMs}ms;时间消耗类型 =「回传链路上游半程,UI 真正画字再加编排+IPC+渲染约几~几十 ms(对照 UI 侧 [端到端] 日志)」`);
			}
			// test-workbench_change end
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

	/** 增量推送推理 part(与 _emitText 同构:先创建、后增量) */
	private _emitReasoning(turnId: string, partID: string, fullText: string): void {
		const sent = this._partReasoningSent.get(partID) ?? 0;
		if (fullText.length <= sent) { return; }
		const delta = fullText.slice(sent);
		this._partReasoningSent.set(partID, fullText.length);
		let protocolPartId = this._partReasoningPartId.get(partID);
		const isNew = !protocolPartId; // test-workbench_change
		if (!protocolPartId) {
			protocolPartId = generateUuid();
			this._partReasoningPartId.set(partID, protocolPartId);
		}
		// test-workbench_change start — 耗时埋点:首段推理(思维链)增量发往编排层
		if (!this._firstReasoningLogged && this._currentTurnStartMs) {
			this._firstReasoningLogged = true;
			this._logService.info(`[耗时][首段推理] 轮次起点→首段 ChatReasoning 增量发往 host 编排层 = ${Date.now() - this._currentTurnStartMs}ms;时间消耗类型 =「推理模型思维链首包,对应 UI 折叠思考区开始滚动」`);
		}
		// test-workbench_change end
		// test-workbench_change start — 首个增量必须先创建 Reasoning part:协议 reducer 的
		// ChatReasoning 走 updateResponsePart,partId 不存在则整段丢弃 → live 思考链不显示
		//(此前只发 ChatReasoning、从不创建,是 opencode 特有缺陷;reload 后 fork 历史会构造
		// Reasoning part 故"重开才看得到")。与 _emitText 同构:创建用 ChatResponsePart{Reasoning}。
		if (isNew) {
			this._fireAction(ActionType.ChatResponsePart, {
				turnId,
				part: { kind: ResponsePartKind.Reasoning, id: protocolPartId, content: delta },
			});
		} else {
			this._fireAction(ActionType.ChatReasoning, {
				turnId,
				partId: protocolPartId,
				content: delta,
			});
		}
		// test-workbench_change end
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
		const state = part.state as { status?: string; title?: string; input?: unknown; output?: string; error?: string; metadata?: Record<string, unknown> } | undefined;
		if (!callID || !tool || !state) { return; }

		// test-workbench_change start — subagent spawn 通道:opencode `task` 工具一旦在
		// part metadata 中暴露子会话 id(ctx.metadata 落地),登记只读 backing 并发
		// subagent_started,host 的 spawn channel 据此把子会话加入 chat catalog。
		if (tool === 'task') {
			// test-workbench_change start — spawn/completed 信号以顶层 chat 为寻址 key(host 的
			// _subagentChats 第一层 key);嵌套时再带本 backing 的被 spawn 边 parentToolCallId,
			// 让发现块挂到 immediate parent。单层时 spawnChat=chatChannelUri、parentEdge 空,与旧行为一致。
			const spawnChat = this._rootChatUri ?? this.chatChannelUri;
			const parentEdge = this._subagentContext?.toolCallId;
			// test-workbench_change end
			const childOpencodeId = state.metadata?.sessionId;
			if (typeof childOpencodeId === 'string' && !this._spawnedSubagentCallIds.has(callID)) {
				this._spawnedSubagentCallIds.add(callID);
				this._registerSubagentSession(callID, childOpencodeId);
				const taskInput = (state.input ?? {}) as { description?: string; prompt?: string; subagent_type?: string };
				const agentName = typeof taskInput.subagent_type === 'string' && taskInput.subagent_type ? taskInput.subagent_type : 'subagent';
				const signal: AgentSignal = {
					kind: 'subagent_started',
					chat: spawnChat,
					toolCallId: callID,
					agentName,
					agentDisplayName: agentName,
					taskDescription: taskInput.description,
					taskPrompt: taskInput.prompt,
					...(parentEdge !== undefined ? { parentToolCallId: parentEdge } : {}),
				};
				try { this._onProgress.fire(signal); } catch { /* disposed */ }
			}
			// test-workbench_change start — 子会话关闭:task 工具进入终态时发 subagent_completed,
			// host 据此关闭子 chat 的 active turn(此前 opencode 从不发该信号,子会话永远停在
			// “思考中”)。仅对本 provider 登记过的 subagent 发,且按 callID 去重。
			if ((state.status === 'completed' || state.status === 'error')
				&& this._spawnedSubagentCallIds.has(callID) && !this._completedSubagentCallIds.has(callID)) {
				this._completedSubagentCallIds.add(callID);
				try {
					this._onProgress.fire({ kind: 'subagent_completed', chat: spawnChat, toolCallId: callID });
				} catch { /* disposed */ }
			}
			// test-workbench_change end
		}
		// test-workbench_change end

		const status = state.status;
		const title = state.title;

		// test-workbench_change start — task 工具的 Start/Ready 必须 stamp `_meta.subagentChatUri`
		// (host agentService._trackPendingSubagentChatFromEnvelope 据此在子会话登记前对 client 的
		// subscribe 做有界等待)。此前 opencode 未 stamp → opencode 后端在 task running 后才暴露子会话
		// id、subagent_started 晚 ~1s,client 抢先订阅未登记的子 chat 报「Resource not found」。
		// subagentChatUri 只依赖 callID(Start 即已知),不需等子会话 id。
		const subagentToolMeta = tool === 'task' ? toToolCallMeta({
			toolKind: 'subagent',
			subagentChatUri: buildSubagentChatUri(this.sessionUri, callID),
			subagentDescription: (state.input as { description?: string } | undefined)?.description,
			subagentAgentName: (typeof (state.input as { subagent_type?: string } | undefined)?.subagent_type === 'string' && (state.input as { subagent_type?: string }).subagent_type) || 'subagent',
		}) : undefined;
		// test-workbench_change end

		// 文件类工具(read/write/edit 等):把路径拼进 markdown 文件链接,
		// chat UI 据此渲染可点击文件 widget(对齐 copilot host 行为)。
		// title 本身就是路径时不重复展示;非路径(描述性 title)保持纯文本。 // test-workbench_change
		const filePath = extractToolFilePath(state.input) ?? (isLikelyAbsolutePath(title) ? title : undefined);
		const fileLink = filePath ? buildFileMarkdownLink(filePath) : undefined;
		const fileMessage = fileLink ? (title !== filePath ? `${title ?? tool} ${fileLink}` : fileLink) : undefined;

		if (!this._dispatchedToolCallIds.has(callID)) {
			this._dispatchedToolCallIds.add(callID);
			// test-workbench_change start — 耗时埋点:本轮首个工具调用发起
			if (this._dispatchedToolCallIds.size === 1 && this._currentTurnStartMs) {
				this._logService.info(`[耗时][首工具调用] 轮次起点→首个工具(${tool})调用发起 = ${Date.now() - this._currentTurnStartMs}ms;时间消耗类型 =「模型决定用工具的时刻,多步 turn 中工具循环时间此后占大头」`);
			}
			// test-workbench_change end
			this._fireAction(ActionType.ChatToolCallStart, {
				turnId,
				toolCallId: callID,
				toolName: tool,
				displayName: title ?? tool,
				intention: title ?? tool,
				...(subagentToolMeta ? { _meta: subagentToolMeta } : {}), // test-workbench_change
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
				...(subagentToolMeta ? { _meta: subagentToolMeta } : {}), // test-workbench_change — arm host 的 pending-subagent 等待
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

	/**
	 * turn 结束时的 subagent 兜底收敛:遍历本父会话登记过的所有 task subagent,
	 * 对因 SSE 漏推终态而仍未关闭的,补发 task 卡片的 ChatToolCallComplete 与
	 * 子 chat 的 subagent_completed。幂等(按 callID 去重),正常路径下全部跳过。 // test-workbench_change
	 */
	private _finalizePendingSubagents(turnId: string): void {
		for (const callID of this._spawnedSubagentCallIds) {
			if (this._completedSubagentCallIds.has(callID)) { continue; }
			this._completedSubagentCallIds.add(callID);
			if (!this._completedToolCallIds.has(callID)) {
				this._completedToolCallIds.add(callID);
				this._fireAction(ActionType.ChatToolCallComplete, {
					turnId,
					toolCallId: callID,
					result: { success: true, pastTenseMessage: 'Subagent completed' },
				});
			}
			try {
				this._onProgress.fire({ kind: 'subagent_completed', chat: this._rootChatUri ?? this.chatChannelUri, toolCallId: callID });
			} catch { /* disposed */ }
		}
	}

	/** 发一次 ChatTurnComplete,按 turn 去重(SSE message.updated 与轮询探测都会到)。 */
	private _completeTurn(turnId: string): void {
		if (this._completedTurnIds.has(turnId)) { return; }
		this._completedTurnIds.add(turnId);
		// test-workbench_change start — subagent 只读 backing 不发 ChatTurnComplete:
		// 子 chat 的 turn 由父 task 工具完成时的 subagent_completed 信号统一关闭
		// (对齐 Codex,避免双重完成与 turnTracker 泄漏)。
		if (this._subagentContext) { return; }
		// test-workbench_change end
		// test-workbench_change start — turn 完成即意味着所有阻塞式 task 子会话已 return。
		// opencode SSE 在长子会话后可能漏推父 task part 的 running→completed 终态,而轮询在
		// _sseHeard 后只保活不再拉取 → task 子卡片与子 chat turn 永不关闭(假性“正在运行”)。
		// 兜底:强制收敛所有未关闭的 subagent,再结束父 turn。幂等,正常 SSE 路径下无副作用。
		this._finalizePendingSubagents(turnId);
		// test-workbench_change end
		// test-workbench_change — 报真实 elapsed:reload 后步骤头 "in Xs" 依赖 duration
		// (此前恒 0 → "in Xs" 在 reload 后消失)。live 时 renderer 有本地兜底,不影响实时观感。
		this._fireAction(ActionType.ChatTurnComplete, { turnId, duration: this._turnElapsedMs() });
	}

	/** 当前 turn 已耗时(ms);无起点(abort 后已 reset)返回 0。 */
	private _turnElapsedMs(): number {
		return this._currentTurnStartMs ? Math.max(0, Date.now() - this._currentTurnStartMs) : 0;
	}

	private _completedTurnIds = new Set<string>();

	/** 结束当前 turn 的等待(SSE finish / abort / 请求错误 / 轮询探测到完成时调用)。 */
	private _finishTurn(): void {
		const resolve = this._resolveTurnFinished;
		this._resolveTurnFinished = undefined;
		// turn 结束:清 abortController 使 hasActiveTurn 归位
		// (prompt_async 下请求本身早已返回,这个信号只标记 turn 生命周期的终点) // test-workbench_change
		this._abortController = undefined;
		// test-workbench_change start — turn 可能刚由 creator agent 写入新的 agent/skill/command
		// 文件,失效 60s 清单缓存:管理面板下一次拉取即重扫(配套 fetchOpenCodeCustomizations
		// 的 POST /reload 后端失效)。再通知 agent 层广播 customizations 变更刷新 state 快照。
		this._customizationsCache = undefined;
		this.onTurnEnd?.();
		// test-workbench_change end
		resolve?.();
	}

	private _resetStreamingState(): void {
		this._partTypes.clear();
		this._partText.clear();
		this._syntheticPartIds.clear(); // test-workbench_change — synthetic part 记录随 turn 复位
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
		// test-workbench_change start — 耗时埋点去重标志复位
		this._sseFirstEventLogged = false;
		this._firstTextLogged = false;
		this._firstReasoningLogged = false;
		this._pollFallbackLogged = false;
		this._turnFinishLogged = false;
		// test-workbench_change end
		this._messageRoles.clear();
		this._currentPrompt = undefined;
		this._completedTurnIds.clear();
		this._modelCallIdsSeen.clear(); // test-workbench_change — model_call 去重集随 turn 复位
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
			case 'question.rejected': {
				// 后端已确认答复:回收 owner 登记(重复 respond 成为 no-op) // test-workbench_change
				const settled = props as { id?: string; requestID?: string };
				if (settled.id) {
					this._pendingAskIds.delete(settled.id);
					// test-workbench_change — 同步清理 call_→per_ 翻译表
					for (const [c, p] of this._permissionIdsByCallId) { if (p === settled.id) { this._permissionIdsByCallId.delete(c); } }
				}
				if (settled.requestID) { this._pendingAskIds.delete(settled.requestID); }
				return;
			}
			case 'session.error':
				// turn 级错误:无当前 turn 时丢弃
				if (this._currentTurnId) { this._handleSessionError(this._currentTurnId, props); }
				return;
		}

		// 以下均为 turn 级事件,无当前 turn 时丢弃
		let turnId = this._currentTurnId;
		// test-workbench_change start — subagent 只读 backing 无 sendMessage 生命周期,
		// abort/reset 后 _currentTurnId 可能为空:补占位 turnId,真实 turn 由 host remap。
		if (!turnId && this._subagentContext) {
			turnId = this._currentTurnId = this.sessionId;
		}
		// test-workbench_change end
		if (!turnId) { return; }

		// 收到任一 turn 级 SSE 事件即标记 SSE 存活,轮询降级为兜底
		this._sseHeard = true;
		// test-workbench_change start — 耗时埋点:后端应答开始。只认 assistant 归属的
		// turn 级事件(用户消息回显已排除)。注意:assistant 的 message.updated 在
		// provider 请求发出时即创建(早于模型首 token),所以本值 ≈「testagent 排队+
		// 预处理完成」;模型真实首包请看 [首段推理]/[首段文本]/[首工具调用]。
		if (!this._sseFirstEventLogged && this._currentTurnStartMs && this._isAssistantTurnEvent(event)) {
			this._sseFirstEventLogged = true;
			this._logService.info(`[耗时][后端应答开始] 轮次起点→testagent 首个 assistant 事件抵达 agent host = ${Date.now() - this._currentTurnStartMs}ms;时间消耗类型 =「testagent 排队+预处理+provider 请求建立(不含模型 TTFT,首包见 [首段推理]/[首段文本])」`);
		}
		// test-workbench_change end

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
				const info = props.info as { id?: string; role?: string; finish?: string; tokens?: Record<string, number>; modelID?: string; providerID?: string } | undefined;
				// 记录每条消息的角色(用户消息的 part 事件到达前,其角色必须已知) // test-workbench_change
				if (info?.id && info?.role) { this._messageRoles.set(info.id, info.role); }
				// 记录 host turn → 本轮最新 opencode 消息 id 锚点(fork/truncate 翻译用;
				// user/assistant 消息都更新,保留的自然是本轮最后一条) // test-workbench_change
				if (info?.id && this._currentTurnId) { this._hostTurnAnchors.set(this._currentTurnId, info.id); }
				// test-workbench_change start — 对齐 Claude/Codex:每条 assistant 消息的 finish(含
				// 中间 tool-calls 步)即一次模型响应完成 → model_call_completed,供 host 记录
				// provider 计时与用量关联。按消息 id 去重(同消息 finish 会多次回填)。
				if (info?.role === 'assistant' && info.id && info.finish && info.finish !== 'unknown' && !this._modelCallIdsSeen.has(info.id)) {
					this._modelCallIdsSeen.add(info.id);
					this._fireModelCallCompleted(turnId, info.id);
				}
				// test-workbench_change end
				// 多步 turn 中 finish 会多次落地(中间步是 tool-calls),只认最终态
				if (info?.role !== 'assistant' || !info.finish || info.finish === 'tool-calls' || info.finish === 'unknown') {
					return;
				}
				// test-workbench_change start — usage.model 供 footer 模型名:stateToProgressAdapter
				// 读 turn.usage.model 为最高优先级来源。opencode assistant info 带 modelID/providerID,
				// 拼成与 models catalog 一致的 `providerID/modelID`。不依赖 ChatTurnStarted 的
				// message.model(会被重复 turn-start 覆盖),也不触碰 subagent 路径。
				if (info.tokens || info.modelID) {
					const modelId = info.modelID ? (info.providerID ? `${info.providerID}/${info.modelID}` : info.modelID) : undefined;
					this._fireAction(ActionType.ChatUsage, {
						turnId,
						usage: {
							totalTokens: info.tokens?.total ?? 0,
							inputTokens: info.tokens?.input ?? 0,
							outputTokens: info.tokens?.output ?? 0,
							...(modelId ? { model: modelId } : {}),
						},
					});
				}
				// test-workbench_change end
				// test-workbench_change start — 耗时埋点:SSE finish 到达 = provider 轮次完成(宿主侧观测);
				// 同一 turn 允许多条 message.updated 携带 finish(如 tokens/cost 回填),只记第一条
				if (this._currentTurnStartMs && !this._turnFinishLogged) {
					this._turnFinishLogged = true;
					this._logService.info(`[耗时][轮次总计] 轮次起点→SSE 收到 assistant 最终 finish = ${Date.now() - this._currentTurnStartMs}ms;时间消耗类型 =「整轮模型+工具循环总时长(宿主进程视角),UI 显示完成态再加回程几~几十 ms」`);
				}
				// test-workbench_change end
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

	// test-workbench_change start — 耗时埋点:判定 turn 级 SSE 事件是否归属 assistant 输出
	// (排除用户消息回显干扰 [LLM首输出] 计时;角色未登记时放行,宁可早计不可漏计)
	private _isAssistantTurnEvent(event: { type: string; properties: Record<string, unknown> }): boolean {
		switch (event.type) {
			case 'message.updated':
				return (event.properties.info as { role?: string } | undefined)?.role === 'assistant';
			case 'message.part.updated': {
				const messageID = (event.properties.part as { messageID?: string } | undefined)?.messageID;
				return !messageID || this._messageRoles.get(messageID) !== 'user';
			}
			case 'message.part.delta': {
				const messageID = event.properties.messageID as string | undefined;
				return !messageID || this._messageRoles.get(messageID) !== 'user';
			}
			default:
				return false; // session.error 等 turn 级事件不计入「首输出」
		}
	}
	// test-workbench_change end

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
			// test-workbench_change — synthetic text part(文本化工具调用/结果)非真实对话,
			// 不渲染;登记 partID 使后续 delta 也跳过。
			if (part.synthetic === true) { this._syntheticPartIds.add(partID); return; }
			// test-workbench_change end
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
		if (this._syntheticPartIds.has(partID)) { return; } // test-workbench_change — synthetic part 的增量不渲染

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
		// test-workbench_change start: AI_APICallError 的真实消息在 error.data.message
		// （如 429 "inference exceeds tpm/rpm limit"），只读 error.message 会丢失原因。
		const error = props.error as { message?: string; data?: { message?: string } } | string | undefined;
		const message = typeof error === 'string' ? error : error?.message ?? error?.data?.message;
		// test-workbench_change end
		// test-workbench_change start: 429/限流等可经用户 Try Again 恢复 → resumable=true + 记录 turnId。
		this._resumableTurnId = turnId;
		this._fireAction(ActionType.ChatError, {
			turnId,
			duration: 0,
			part: createErrorResponsePart({
				errorType: 'unknown',
				message: message ?? 'OpenCode session error',
			}, true),
		});
		// test-workbench_change end
	}

	// test-workbench_change start — Try Again:以原 turnId 重发失败的 turn(不新增用户消息;
	// opencode 服务端会话上下文仍在,prompt_async 续接对话)。
	async resumeTurn(turnId: string): Promise<void> {
		if (this._resumableTurnId !== turnId || !this._lastSend) {
			throw new Error(`TestAgent session has no resumable turn: ${turnId}`);
		}
		this._resumableTurnId = undefined;
		await this.sendMessage(this._lastSend.prompt, this._lastSend.workingDirectory, this._lastSend.attachments, turnId, this._lastSend.tools);
	}
	// test-workbench_change end

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
		// 登记 owner:agent 级广播 respond 时仅本 session 真正回包 // test-workbench_change
		this._pendingAskIds.set(requestID, 'permission');
		// test-workbench_change — 记录 call_→per_ 翻译表:用户确认时 host 只带 toolCallId
		this._permissionIdsByCallId.set(callID, requestID);

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
		// 登记 owner(同 permission.asked)// test-workbench_change
		this._pendingAskIds.set(requestID, 'question');

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
		// test-workbench_change — workspace-routing 中间件按 x-opencode-directory 定位实例;
		// 不带此头的 GET/fork/truncate/DELETE 在多目录 server 上会路由到错误 instance。
		if (this._workingDirectory) { headers['x-opencode-directory'] = encodeURIComponent(this._workingDirectory.fsPath); }

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
				throw new Error(`TestAgent ${method} ${path} failed: HTTP ${resp.status} ${text}`);
			}
			return await resp.json() as T;
		} finally {
			clearTimeout(timer);
		}
	}

	// ── Action emission ────────────────────────────────────────────────────

	private _fireAction(type: string, fields: Record<string, unknown>): void {
		// test-workbench_change start — subagent 只读 backing 的 action 必须以父 chat 为 resource
		// 并带 parentToolCallId:host 的 spawn channel 据此 remap 到子 chat 的 active turn。
		// 若直接用子 chat URI 作 resource,会走 preserve 路径,占位 turnId 与 host turnId 不符被丢。
		const signal: IAgentActionSignal = this._subagentContext
			? {
				kind: 'action',
				resource: this._subagentContext.parentChat,
				parentToolCallId: this._subagentContext.toolCallId,
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
				action: { type, ...fields } as unknown as SessionAction | ChatAction,
			}
			: {
				kind: 'action',
				resource: this.chatChannelUri,
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
				action: { type, ...fields } as unknown as SessionAction | ChatAction,
			};
		// test-workbench_change end
		try { this._onProgress.fire(signal); } catch { /* disposed */ }
	}
}

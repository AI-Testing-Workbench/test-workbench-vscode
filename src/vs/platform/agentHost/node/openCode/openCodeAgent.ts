/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { dirname, join } from '../../../../base/common/path.js'; // test-workbench_change
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { IObservable, observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import {
	AgentProvider, AgentSession, AgentSignal,
	IActiveClient, IAgent, IAgentChats, IAgentCreateChatOptions,
	IAgentCreateChatForkSource, IAgentCreateChatResult, IAgentCreateSessionConfig,
	IAgentCreateSessionResult, IAgentDescriptor, IAgentModelInfo,
	IAgentResolveSessionConfigParams, IAgentSessionConfigCompletionsParams,
	IAgentSessionMetadata,
	OPENCODE_AGENT_PROVIDER_ID,
} from '../../common/agentService.js';
import { IAgentServerToolHost } from '../../common/agentServerTools.js';
import type {
	ResolveSessionConfigResult, SessionConfigCompletionsResult,
} from '../../common/state/protocol/commands.js';
import { type AuthRequiredParams } from '../../common/state/sessionActions.js';
import {
	ProtectedResourceMetadata,
	type AgentSelection, type ModelSelection,
	type ChatInputResponseKind, type ChatInputAnswer,
	type ToolDefinition,
} from '../../common/state/protocol/state.js';
import {
	type MessageAttachment,
	type ToolCallResult, type Turn,
	isDefaultChatUri,
	parseChatUri,
} from '../../common/state/sessionState.js';
import { ActiveClientToolSet } from '../activeClientState.js';
import { IOpenCodeSession, OpenCodeSession } from './openCodeSession.js';
import { OpenCodeEventStream } from './openCodeEventStream.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENCODE_STARTUP_TIMEOUT = 30_000;
const OPENCODE_REQUEST_TIMEOUT = 120_000;

// ── Connection state ──────────────────────────────────────────────────────────

type ConnectionState =
	| { readonly kind: 'idle' }
	| { readonly kind: 'starting'; readonly promise: Promise<ConnectionReady> }
	| ({ readonly kind: 'ready' } & ConnectionReady);

interface ConnectionReady {
	readonly baseUrl: string;
	readonly child: cp.ChildProcessWithoutNullStreams;
	readonly authHeader: string;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class OpenCodeAgent extends Disposable implements IAgent {

	readonly id: AgentProvider = OPENCODE_AGENT_PROVIDER_ID;

	private readonly _onDidSessionProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidSessionProgress = this._onDidSessionProgress.event;

	private readonly _onDidRequireAuth = this._register(new Emitter<Omit<AuthRequiredParams, 'channel'>>());
	readonly onDidRequireAuth = this._onDidRequireAuth.event;

	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, []);
	readonly models: IObservable<readonly IAgentModelInfo[]> = this._models;

	private readonly _sessions = this._register(new DisposableMap<string, IOpenCodeSession>());
	/** 多 chat 支持:chat channel URI → OpenCodeSession(peer chat 拥有独立 opencode 会话) */
	private readonly _peerChatSessions = new Map<string, IOpenCodeSession>();
	private readonly _toolSets = new Map<string, ActiveClientToolSet>();
	private _serverToolHost: IAgentServerToolHost | undefined;
	private _eventStream: OpenCodeEventStream | undefined;
	private _connection: ConnectionState = { kind: 'idle' };
	private _authHeader: string | undefined;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	// ── Server tool host ───────────────────────────────────────────────────

	setServerToolHost(host: IAgentServerToolHost): void {
		this._serverToolHost = host;
	}

	// ── IAgent descriptor ──────────────────────────────────────────────────

	getDescriptor(): IAgentDescriptor {
		return {
			provider: this.id,
			displayName: 'TestAgent', // test-workbench_change 命名:opencode fork → TestAgent
			description: 'TestAgent agent - a terminal-native AI coding assistant',
		};
	}

	// ── IAgentChats ────────────────────────────────────────────────────────

	readonly chats: IAgentChats = {
		createChat: async (chat: URI, options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void> => {
			const ready = await this._ensureConnection();
			const sessionId = generateUuid();
			const sessionUri = AgentSession.uri(this.id, sessionId);

			const workingDirectory = URI.file('/tmp/opencode-' + sessionId);
			try { fs.mkdirSync(workingDirectory.fsPath, { recursive: true }); } catch { /* ignore */ }

			const session = new OpenCodeSession(
				sessionId, sessionUri,
				ready.baseUrl, ready.authHeader,
				this._onDidSessionProgress,
				this._logService,
			);
			this._sessions.set(sessionId, session);
			this._peerChatSessions.set(chat.toString(), session);
			await session.initialize();
			if (options?.model) { session.setModel(options.model); }
			this._logService.info(`[OpenCode] peer chat created: ${chat.toString()} (opencode: ${session.opencodeSessionId})`);
			// providerData 统一为 fork opencode 会话 ID:materializeChat 按它重挂
			// (fork 的 POST /session 不允许指定 ID,只能用返回值登记)。 // test-workbench_change
			return { providerData: session.opencodeSessionId };
		},
		fork: async (chat: URI, source: IAgentCreateChatForkSource, _options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void> => {
			const sourceSession = this._resolveSession(source?.source ?? chat);
			if (!sourceSession) {
				throw new Error(`OpenCode source session not found for fork: ${source?.source?.toString() ?? chat.toString()}`);
			}
			const ready = await this._ensureConnection();
			const forkedId = await sourceSession.fork(source?.turnId);

			// fork 返回的是已创建好的 opencode 会话,直接注册新 OpenCodeSession(无需再 initialize)
			const sessionId = generateUuid();
			const sessionUri = AgentSession.uri(this.id, sessionId);
			this._sessions.deleteAndDispose(sessionId);

			const workingDirectory = URI.file('/tmp/opencode-' + sessionId);
			try { fs.mkdirSync(workingDirectory.fsPath, { recursive: true }); } catch { /* ignore */ }

			const session = new OpenCodeSession(
				sessionId, sessionUri,
				ready.baseUrl, ready.authHeader,
				this._onDidSessionProgress,
				this._logService,
			);
			session.opencodeSessionId = forkedId;
			this._sessions.set(sessionId, session);
			this._logService.info(`[OpenCode] forked session ${sessionId} (opencode: ${forkedId})`);

			return { providerData: forkedId };
		},
		disposeChat: async (chat: URI): Promise<void> => {
			const session = this._peerChatSessions.get(chat.toString());
			if (!session) { return; }
			this._peerChatSessions.delete(chat.toString());
			try {
				const ready = await this._ensureConnection();
				if (session.opencodeSessionId) {
					await this._request(ready, 'DELETE', `/session/${session.opencodeSessionId}`);
				}
			} catch { /* ignore */ }
			this._sessions.deleteAndDispose(AgentSession.id(session.sessionUri));
		},
		sendMessage: async (chat: URI, prompt: string, _workingDirectory: URI | undefined, _attachments?: readonly MessageAttachment[], turnId?: string, _senderClientId?: string): Promise<void> => {
			const session = this._resolveSession(chat);
			if (!session) {
				throw new Error(`OpenCode session not found for chat ${chat.toString()}`);
			}
			const toolNames = this._getEnabledToolNames(chat);
			await session.sendMessage(prompt, _workingDirectory, _attachments, turnId, toolNames);
		},
		abort: async (chat: URI): Promise<void> => {
			const session = this._resolveSession(chat);
			if (session) { session.abort(); }
		},
		changeModel: async (chat: URI, model: ModelSelection): Promise<void> => {
			const session = this._resolveSession(chat);
			if (!session) {
				throw new Error(`OpenCode session not found for chat ${chat.toString()}`);
			}
			session.setModel(model);
		},
		changeAgent: async (_chat: URI, _agent: AgentSelection | undefined): Promise<void> => { },
		getMessages: async (chat: URI): Promise<readonly Turn[]> => {
			const session = this._resolveSession(chat);
			if (!session) { return []; }
			return session.getMessages();
		},
	};

	// ── Session lifecycle ──────────────────────────────────────────────────

	async createSession(config: IAgentCreateSessionConfig = {}): Promise<IAgentCreateSessionResult> {
		const ready = await this._ensureConnection();
		const sessionId = config.session ? AgentSession.id(config.session) : generateUuid();
		const sessionUri = AgentSession.uri(this.id, sessionId);

		this._sessions.deleteAndDispose(sessionId);

		const workingDirectory = config.workingDirectory
			?? URI.file('/tmp/opencode-' + sessionId);

		// 默认工作目录是合成的(/tmp/opencode-<sessionId>),并不真实存在;
		// 必须创建它,否则持久化会话在恢复时会被
		// WorktreeIsolation.resolveWorkingDirectoryForResume 判定为缺失,
		// 抛出 SessionWorkingDirectoryMissingError。 // test-workbench_change
		if (!config.workingDirectory) {
			try {
				fs.mkdirSync(workingDirectory.fsPath, { recursive: true });
			} catch (err) {
				this._logService.warn(`[OpenCode] failed to create default working directory ${workingDirectory.fsPath}: ${err}`);
			}
		}

		const session = new OpenCodeSession(
			sessionId, sessionUri,
			ready.baseUrl, ready.authHeader,
			this._onDidSessionProgress,
			this._logService,
		);

		// 恢复路径:orchestrator 重发已分配 session 时,按映射重挂 fork 既有会话
		// (保住历史),而不是再建一个空会话。 // test-workbench_change
		if (config.session) {
			session.knownOpencodeSessionId = this._getOpencodeId(sessionId);
		}
		session.onSessionCreated = (opencodeSessionId) => {
			this._rememberOpencodeId(sessionId, opencodeSessionId);
		};

		this._sessions.set(sessionId, session);
		await session.initialize();

		return { session: sessionUri, workingDirectory };
	}

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		try {
			const ready = await this._ensureConnection();
			const sessionList = await this._request<Array<{ id: string; title?: string; slug?: string }>>(
				ready, 'GET', '/session/',
			);
			const now = Date.now();
			return sessionList.map(s => ({
				session: AgentSession.uri(this.id, s.id),
				startTime: now,
				modifiedTime: now,
				summary: s.title ?? s.slug,
			}));
		} catch {
			return [];
		}
	}

	async getSessionMessages(sessionUri: URI): Promise<readonly Turn[]> {
		const session = this._resolveSessionByUri(sessionUri);
		if (!session) { return []; }
		return session.getMessages();
	}

	async disposeSession(sessionUri: URI): Promise<void> {
		const sessionId = AgentSession.id(sessionUri);
		const session = this._sessions.get(sessionId);
		if (session) {
			try {
				const ready = await this._ensureConnection();
				await this._request(ready, 'DELETE', `/session/${session.opencodeSessionId ?? sessionId}`);
			} catch { /* ignore */ }
			this._sessions.deleteAndDispose(sessionId);
			this._toolSets.delete(sessionId);
			this._forgetOpencodeId(sessionId); // 同步清掉持久化映射,避免恢复时重挂已删会话
		}
	}

	/**
	 * 会话恢复时重挂 peer chat 的 fork 会话(按 createChat/fork 持久化的
	 * providerData,即 opencode 会话 ID)。与 createChat 一致:每个 peer chat
	 * 拥有独立伪 session,`_peerChatSessions` 按 chat URI 索引保证
	 * `_resolveSession` 命中。Best-effort:fork 会话已删除/不可达时记日志并
	 * 降级为"有历史、无 live backing",不抛出(orchestrator 协议约定)。
	 */
	async materializeChat(chat: URI, providerData: string | undefined): Promise<void> {
		// 默认 chat 由 createSession 恢复路径负责,不走这里
		if (isDefaultChatUri(chat)) { return; }
		if (providerData === undefined) {
			this._logService.warn(`[OpenCode] materializeChat: no providerData for ${chat.toString()}; chat restores with history but no live backing`);
			return;
		}
		if (this._peerChatSessions.has(chat.toString())) { return; }

		try {
			const ready = await this._ensureConnection();
			// 验证 fork 侧会话仍存在(拿到规范 ID),不存在则降级
			const info = await this._request<{ id: string }>(ready, 'GET', `/session/${providerData}`);
			const opencodeSessionId = info.id ?? providerData;

			const sessionId = generateUuid();
			const sessionUri = AgentSession.uri(this.id, sessionId);
			const session = new OpenCodeSession(
				sessionId, sessionUri,
				ready.baseUrl, ready.authHeader,
				this._onDidSessionProgress,
				this._logService,
			);
			session.opencodeSessionId = opencodeSessionId;
			this._sessions.set(sessionId, session);
			this._peerChatSessions.set(chat.toString(), session);
			this._logService.info(`[OpenCode] peer chat materialized: ${chat.toString()} (opencode: ${opencodeSessionId})`);
		} catch (err) {
			this._logService.warn(`[OpenCode] materializeChat failed for ${chat.toString()}: ${err}`);
		}
	}

	// ── Permissions ────────────────────────────────────────────────────────

	/**
	 * 空闲回收(非破坏性):释放会话的内存态,不动 fork 侧持久数据、
	 * 不清 sessionId 映射。下次访问透明重挂 —— 主会话走 createSession
	 * 恢复路径,peer chat 走 materializeChat。turn 进行中不释放
	 * (orchestrator fire-and-forget 调用,provider 自检不变量)。
	 */
	async releaseSession(session: URI): Promise<void> {
		const sessionId = AgentSession.id(session);
		const opencodeSession = this._sessions.get(sessionId);
		if (!opencodeSession || opencodeSession.hasActiveTurn) { return; }
		this._sessions.deleteAndDispose(sessionId);
		this._toolSets.delete(sessionId);
		// 一并释放挂在同一会话上的 peer chat backing
		for (const [chatStr, s] of this._peerChatSessions) {
			if (s === opencodeSession) { this._peerChatSessions.delete(chatStr); }
		}
		this._logService.info(`[OpenCode] released idle session ${sessionId} (opencode: ${opencodeSession.opencodeSessionId ?? '?'})`);
	}

	respondToPermissionRequest(_requestId: string, _approved: boolean): void {
		for (const [, s] of this._sessions) {
			s.respondToPermissionRequest(_requestId, _approved);
		}
	}

	respondToUserInputRequest(requestId: string, response: ChatInputResponseKind, answers?: Record<string, ChatInputAnswer>): void {
		for (const [, s] of this._sessions) {
			s.respondToUserInputRequest(requestId, response, answers);
		}
	}

	// ── Configuration ──────────────────────────────────────────────────────

	async resolveSessionConfig(_params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		return { schema: { type: 'object', properties: {} }, values: {} };
	}

	async sessionConfigCompletions(_params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return { items: [] };
	}

	// ── Client tools ───────────────────────────────────────────────────────

	getOrCreateActiveClient(sessionUri: URI, client: { readonly clientId: string; readonly displayName?: string }): IActiveClient {
		const sessionKey = AgentSession.id(sessionUri);
		let toolSet = this._toolSets.get(sessionKey);
		if (!toolSet) {
			toolSet = new ActiveClientToolSet();
			this._toolSets.set(sessionKey, toolSet);
		}
		return {
			clientId: client.clientId,
			displayName: client.displayName ?? client.clientId,
			get tools() { return toolSet!.get(client.clientId); },
			set tools(val: readonly ToolDefinition[]) { toolSet!.set(client.clientId, val); },
			customizations: [],
		};
	}

	removeActiveClient(session: URI, clientId: string): void {
		const sessionKey = AgentSession.id(session);
		this._toolSets.get(sessionKey)?.delete(clientId);
	}

	onClientToolCallComplete(_session: URI, _chat: URI, _toolCallId: string, _result: ToolCallResult): void { }

	private _getEnabledToolNames(chatUri: URI): string[] {
		const parsed = parseChatUri(chatUri);
		const sessionUri = parsed ? URI.parse(parsed.session) : chatUri;
		const sessionKey = AgentSession.id(sessionUri);
		const toolSet = this._toolSets.get(sessionKey);
		const clientTools = toolSet?.merged() ?? [];
		const serverTools = this._serverToolHost?.definitions ?? [];
		const seen = new Set<string>();
		const result: string[] = [];
		for (const t of serverTools) { if (!seen.has(t.name)) { seen.add(t.name); result.push(t.name); } }
		for (const t of clientTools) { if (!seen.has(t.name)) { seen.add(t.name); result.push(t.name); } }
		return result;
	}

	// ── Auth ───────────────────────────────────────────────────────────────

	getProtectedResources(): ProtectedResourceMetadata[] {
		return [];
	}

	async authenticate(_resource: string, _token: string): Promise<boolean> {
		return true;
	}

	// ── Shutdown ───────────────────────────────────────────────────────────

	async shutdown(): Promise<void> {
		this._eventStream?.dispose();
		this._eventStream = undefined;
		if (this._connection.kind === 'ready') {
			this._connection.child.kill();
		}
		this._connection = { kind: 'idle' };
	}

	// ── Private ────────────────────────────────────────────────────────────

	private _resolveSession(chatUri: URI): IOpenCodeSession | undefined {
		// 多 chat 支持:peer chat 优先按 chat URI 匹配独立的 OpenCodeSession
		const peer = this._peerChatSessions.get(chatUri.toString());
		if (peer) { return peer; }

		const parsed = parseChatUri(chatUri);
		const sessionUri = parsed ? URI.parse(parsed.session) : chatUri;
		for (const [, s] of this._sessions) {
			if (s.sessionUri.toString() === sessionUri.toString()) {
				return s;
			}
		}
		return undefined;
	}

	private _resolveSessionByUri(sessionUri: URI): IOpenCodeSession | undefined {
		return this._sessions.get(AgentSession.id(sessionUri));
	}

	private _getAuthHeader(): string {
		if (!this._authHeader) {
			const envAuth = process.env['OPENCODE_AUTH'];
			if (envAuth) {
				this._authHeader = envAuth;
			} else {
				this._authHeader = 'Basic ' + Buffer.from('opencode:dev').toString('base64');
			}
		}
		return this._authHeader;
	}

	// ── Spawn connection ───────────────────────────────────────────────────

	private async _ensureConnection(): Promise<ConnectionReady> {
		if (this._connection.kind === 'ready') { return this._connection; }
		if (this._connection.kind === 'starting') { return this._connection.promise; }

		const promise = this._startConnection().then(ready => {
			this._connection = { kind: 'ready', ...ready };
			this._startEventStream(ready.baseUrl, ready.authHeader);
			// 连接建立后动态拉取模型列表(替代硬编码 OPENCODE_MODELS)
			void this._refreshModels(ready);
			return ready;
		}).catch(err => {
			this._connection = { kind: 'idle' };
			throw err;
		});
		this._connection = { kind: 'starting', promise };
		return promise;
	}

	private _startConnection(): Promise<ConnectionReady> {
		return new Promise<ConnectionReady>((resolve, reject) => {
			const args = ['serve', '--port=0'];
			const env: NodeJS.ProcessEnv = { ...process.env };

			// 允许通过 OPENCODE_BIN 环境变量覆盖后端二进制;
			// 缺省解析 PATH 中的 testagent。 // test-workbench_change
			const bin = process.env['OPENCODE_BIN'] || 'testagent';

			this._logService.info(`[OpenCode] spawning ${bin} serve --port=0`);

			const child = cp.spawn(bin, args, {
				env,
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			this._guardBackendProcessLifecycle(child); // test-workbench_change

			const authHeader = this._getAuthHeader();
			let resolved = false;

			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					child.kill();
					reject(new Error('OpenCode process failed to start within timeout'));
				}
			}, OPENCODE_STARTUP_TIMEOUT);

			let stdout = '';
			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => {
				stdout += chunk;
				const match = stdout.match(/opencode server listening on (https?:\/\/[^\s]+)/);
				if (match && !resolved) {
					resolved = true;
					clearTimeout(timer);
					resolve({ baseUrl: match[1], child, authHeader });
				}
			});

			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (chunk: string) => {
				this._logService.trace(`[OpenCode stderr] ${String(chunk).trimEnd()}`);
			});

			child.on('error', (err) => {
				if (!resolved) { resolved = true; clearTimeout(timer); reject(err); }
			});

			child.on('exit', (code, signal) => {
				this._logService.warn(`[OpenCode] process exited code=${code} signal=${signal}`);
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					reject(new Error(`OpenCode process exited early with code ${code}`));
				}
				if (this._connection.kind === 'ready') {
					this._handleConnectionLost();
				}
			});
		});
	}

	// test-workbench_change start
	// VS Code 退出时以 SIGTERM(POSIX)或直接 TerminateProcess(Windows)结束 agent host,默认行为不走
	// OpenCodeAgent.shutdown(),spawn 出的 testagent 会变孤儿。这里兜底当前存活的后端进程:
	// 捕获 SIGTERM/SIGINT 与进程 exit,同步 kill。Windows 硬终止场景由 electron-main 侧 taskkill /T 树杀兜底。
	private _backendChild: cp.ChildProcess | undefined;
	private static _backendSignalGuardsInstalled = false;

	private _guardBackendProcessLifecycle(child: cp.ChildProcess): void {
		this._backendChild = child;
		child.once('exit', () => {
			if (this._backendChild === child) {
				this._backendChild = undefined;
			}
		});
		if (OpenCodeAgent._backendSignalGuardsInstalled) {
			return;
		}
		OpenCodeAgent._backendSignalGuardsInstalled = true;
		const killBackend = () => {
			try { this._backendChild?.kill(); } catch { /* already exited */ }
		};
		const onSignal = () => { killBackend(); process.exit(0); };
		process.on('SIGTERM', onSignal);
		process.on('SIGINT', onSignal);
		process.once('exit', killBackend);
	}
	// test-workbench_change end

	private _handleConnectionLost(): void {
		this._logService.warn('[OpenCode] connection lost');
		this._eventStream?.stop();
		for (const [, session] of this._sessions) {
			session.onConnectionLost();
		}
		this._connection = { kind: 'idle' };
	}

	private _startEventStream(baseUrl: string, authHeader: string): void {
		this._eventStream?.dispose();
		this._eventStream = new OpenCodeEventStream(
			baseUrl,
			authHeader,
			(sessionID: string, event) => {
				const session = this._findSessionByOpencodeId(sessionID);
				if (session) {
					session.handleEvent(event);
				}
			},
			this._logService,
		);
		this._eventStream.start();
	}

	private _findSessionByOpencodeId(opencodeSessionId: string): IOpenCodeSession | undefined {
		for (const [, s] of this._sessions) {
			if (s.opencodeSessionId === opencodeSessionId) {
				return s;
			}
		}
		return undefined;
	}

	// ── Models ──────────────────────────────────────────────────────────────

	/** 从 fork `GET /provider` 拉取模型列表并刷新 `_models` observable。 */
	private async _refreshModels(ready: ConnectionReady): Promise<void> {
		try {
			// fork Provider.ListResult = { all: Info[], default, connected };
			// Info.models = Record<modelID, Model>,Model.capabilities.input.image 决定是否支持视觉。
			const resp = await this._request<{
				all?: Array<{
					id?: string;
					name?: string;
					models?: Record<string, {
						id?: string;
						name?: string;
						status?: string;
						capabilities?: { input?: { image?: boolean } };
					}>;
				}>;
				connected?: string[];
			}>(ready, 'GET', '/provider');

			// fork 的 /provider.all 返回完整 models.dev 目录(200+ provider、7000+ 模型),
			// 但只有 connected 中列出的 provider 才真正可用(有凭据/已连接)。
			// 选中未连接 provider 的模型会让服务端 getModel 抛 ProviderModelNotFoundError → 500。
			// 因此 UI 模型列表只暴露 connected 的 provider;connected 缺失(旧版本)时回退全量。
			const connectedSet = resp.connected && resp.connected.length > 0
				? new Set(resp.connected)
				: undefined;

			const models: IAgentModelInfo[] = [];
			for (const provider of resp.all ?? []) {
				if (connectedSet && provider.id && !connectedSet.has(provider.id)) { continue; }
				for (const model of Object.values(provider.models ?? {})) {
					// 跳过已废弃模型
					if (model.status === 'deprecated') { continue; }
					models.push({
						provider: OPENCODE_AGENT_PROVIDER_ID,
						// id 统一为 providerID/modelID:sendMessage 按 '/' 拆分出
						// body.model = { providerID, modelID },裸 modelID 会导致换模型失效
						id: provider.id ? `${provider.id}/${model.id ?? ''}` : (model.id ?? ''),
						name: model.name ?? model.id ?? '',
						supportsVision: model.capabilities?.input?.image === true,
					});
				}
			}
			// 只在拿到非空列表时替换(空列表意味着 /provider 失败,保留现状)。
			// 避免陈旧/无效模型 ID 被 UI 选中后经 body.model 触发服务端 500。 // test-workbench_change
			if (models.length > 0) {
				this._models.set(models, undefined, undefined);
				this._logService.info(`[OpenCode] loaded ${models.length} models from /provider`);
			} else {
				this._logService.warn('[OpenCode] /provider returned no models; keeping current model list');
			}
		} catch (err) {
			this._logService.warn(`[OpenCode] failed to refresh models: ${err}`);
		}
	}

	// ── Session ID mapping(跨 host 进程重启)────────────────────────────────

	/**
	 * 记录 agent sessionId → fork opencode 会话 ID 的映射文件。
	 * fork 的 `POST /session` 不允许指定会话 ID,映射是 host 进程重启后
	 * 恢复会话(重挂既有 fork 会话,保住历史)的唯一依据。
	 * 文件损坏/缺失时安全降级为空映射(退化为新建会话)。 // test-workbench_change
	 */
	private _sessionMapPath: string | undefined;
	private _sessionMap: Record<string, string> | undefined;

	private _getOpencodeId(agentSessionId: string): string | undefined {
		if (!this._sessionMap) {
			this._sessionMap = this._loadSessionMap();
		}
		return this._sessionMap[agentSessionId];
	}

	private _rememberOpencodeId(agentSessionId: string, opencodeSessionId: string): void {
		if (!this._sessionMap) {
			this._sessionMap = this._loadSessionMap();
		}
		this._sessionMap[agentSessionId] = opencodeSessionId;
		this._saveSessionMap();
	}

	private _forgetOpencodeId(agentSessionId: string): void {
		if (!this._sessionMap) { return; }
		if (Object.hasOwn(this._sessionMap, agentSessionId)) {
			delete this._sessionMap[agentSessionId];
			this._saveSessionMap();
		}
	}

	private _loadSessionMap(): Record<string, string> {
		const file = this._sessionMapFile();
		try {
			const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
			const result: Record<string, string> = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (typeof v === 'string') { result[k] = v; }
			}
			return result;
		} catch {
			return {};
		}
	}

	private _saveSessionMap(): void {
		try {
			const file = this._sessionMapFile();
			fs.mkdirSync(dirname(file), { recursive: true });
			fs.writeFileSync(file, JSON.stringify(this._sessionMap ?? {}, null, 2), 'utf8');
		} catch (err) {
			this._logService.warn(`[OpenCode] failed to persist session map: ${err}`);
		}
	}

	private _sessionMapFile(): string {
		if (!this._sessionMapPath) {
			this._sessionMapPath = join(
				os.homedir(), '.test-workbench-agent-host', 'opencode-sessions.json',
			);
		}
		return this._sessionMapPath;
	}

	// ── HTTP helpers ───────────────────────────────────────────────────────

	private async _request<T>(ready: ConnectionReady, method: string, path: string, body?: unknown): Promise<T> {
		const url = `${ready.baseUrl}${path}`;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (ready.authHeader) { headers['Authorization'] = ready.authHeader; }

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), OPENCODE_REQUEST_TIMEOUT);

		try {
			const resp = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});
			if (!resp.ok) {
				throw new Error(`OpenCode ${method} ${path} failed: HTTP ${resp.status}`);
			}
			return await resp.json() as T;
		} finally {
			clearTimeout(timer);
		}
	}
}

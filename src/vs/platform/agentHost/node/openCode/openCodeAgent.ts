/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { dirname, join } from '../../../../base/common/path.js'; // test-workbench_change
import { Emitter, Event } from '../../../../base/common/event.js';
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
	IAgentMaterializeChatEvent, // test-workbench_change — provisional chat materialize 事件
	IAgentSessionMetadata,
	OPENCODE_AGENT_PROVIDER_ID,
} from '../../common/agentService.js'; // test-workbench_change - 移除已改名的 IAgentResolveSessionConfigParams/IAgentSessionConfigCompletionsParams
// test-workbench_change start - 新上游 chat-addressed IAgent 契约适配所需类型
import {
	type AgentChatOperationContext,
	type IAgentHostCapabilities,
	type IAgentChatMetadata,
	type IAgentChatMetadataOptions,
	type IAgentResolveChatConfigParams,
	type IAgentChatConfigCompletionsParams,
	type AgentChatMigrationResult,
	// test-workbench_change — 外部会话发现 / 注册迁移契约
	type IAgentDiscoveredChat,
	type IAgentKnownSessionsFilter,
	AgentChatMigrationDeferred,
} from '../../common/agent.js';
// test-workbench_change end
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
	type Customization, type DirectoryCustomization, // test-workbench_change
	isDefaultChatUri,
	parseChatUri,
	buildDefaultChatUri, // test-workbench_change — 外部发现
	isSubagentChatUri, // test-workbench_change — subagent chat 寻址
} from '../../common/state/sessionState.js';
import { ActiveClientToolSet } from '../activeClientState.js';
import { IOpenCodeSession, OpenCodeSession } from './openCodeSession.js';
import { OpenCodeEventStream } from './openCodeEventStream.js';
// test-workbench_change start — describeCustomization:合成 customization URI 的只读详情视图数据源
import { fetchOpenCodeCustomizations, userTestagentConfigRoot } from './openCodeCustomizations.js';
// test-workbench_change end
// test-workbench_change — 审批档位 picker 已移除:权限完全由 testagent.jsonc 决定,
// openCodeSessionConfigKeys.ts 随之删除(原 IAgentConfigurationService 注入一并回收)。
// test-workbench_change end

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENCODE_STARTUP_TIMEOUT = 90_000; // test-workbench_change — 30s→90s：163MB bun 单文件二进制在 macOS 首次 exec 需冷签名验证+页载入(企业 EDR 还会首扫),实测首轮 30s 内未打出 listening 被误杀,第二次 spawn 才 12s 就绪
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

	// test-workbench_change start - 适配新上游 IAgent 契约
	readonly agentHostCapabilities: IAgentHostCapabilities = { workspaceConversion: false };

	private readonly _onDidSessionProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidChatProgress = this._onDidSessionProgress.event;

	// 单/有限 chat provider:以下 orchestrator 事件由上层目录管理,agent 自身不触发
	// test-workbench_change start — provisional chat 在首次 sendMessage 时升级为真实
	// opencode 会话并 fire 本事件(orchestrator 借此发出 sessionAdded/SessionReady、
	// 持久化 defaultChatProviderData 与 backingSession 标记)
	private readonly _onDidMaterializeChat = this._register(new Emitter<IAgentMaterializeChatEvent>());
	readonly onDidMaterializeChat = this._onDidMaterializeChat.event;
	// test-workbench_change end
	readonly onDidChangeChatData = Event.None;
	readonly onDidSpawnChat = Event.None; // subagent 经 onDidChatProgress 的 subagent_started signal 走共享 spawn channel（SubagentChatSignal）
	// test-workbench_change start — 外部会话发现:opencode CLI 等 surface 创建的 native
	// 会话推入 orchestrator registry。lazy:不为发现单独 spawn 后端,首次连接建立后补发。
	private readonly _onDidDiscoverChats = this._register(new Emitter<readonly IAgentDiscoveredChat[]>());
	readonly onDidDiscoverChats = this._onDidDiscoverChats.event;
	private _knownSessionsFilter: IAgentKnownSessionsFilter | undefined;
	private _backendActivated = false;
	private _chatDiscoveryDone = false;
	private _chatDiscoveryRequested = false;
	// test-workbench_change end

	private readonly _onDidRequireAuth = this._register(new Emitter<Omit<AuthRequiredParams, 'channel'>>());
	readonly onDidRequireAuth = this._onDidRequireAuth.event;

	// test-workbench_change start — customizations 变更事件:AgentSideEffects 订阅后对全部会话
	// 重取 getChatCustomizations 并 dispatch SessionCustomizationsChanged(select/管理面板读的是
	// 这份 state 快照,只清 session 缓存不会刷新 UI)。Claude 已实现本事件,OpenCode 此前缺失
	// → 删除/新增 agent 后快照不更新,要 reload window 才可见。
	private readonly _onDidCustomizationsChange = this._register(new Emitter<void>());
	readonly onDidCustomizationsChange = this._onDidCustomizationsChange.event;
	private readonly _customizationWatchers = new Map<string, fs.FSWatcher>();
	private _customizationsDebounce: ReturnType<typeof setTimeout> | undefined;
	// test-workbench_change end

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

	// test-workbench_change start — 释放 customization 目录 watcher 与防抖定时器
	override dispose(): void {
		if (this._customizationsDebounce !== undefined) {
			clearTimeout(this._customizationsDebounce);
			this._customizationsDebounce = undefined;
		}
		for (const [, w] of this._customizationWatchers) {
			try { w.close(); } catch { /* ignore */ }
		}
		this._customizationWatchers.clear();
		super.dispose();
	}
	// test-workbench_change end

	// ── IAgent descriptor ──────────────────────────────────────────────────

	getDescriptor(): IAgentDescriptor {
		return {
			provider: this.id,
			displayName: 'TestAgent', // test-workbench_change 命名:opencode fork → TestAgent
			description: 'TestAgent agent - a terminal-native AI coding assistant',
			// test-workbench_change start - 对齐 Claude/Codex/Copilot 的能力声明:
			// chats.createChat(options.fork) + POST /session/:id/fork 已实现,
			// sideChat 由 host 解析为 fork(见 IAgentCreateChatRequestOptions),
			// 不声明则 UI 的 Add Chat / Fork 被 context key 屏蔽。
			capabilities: {
				multipleChats: { fork: true, sideChat: true },
			},
			// test-workbench_change end
		};
	}

	// ── IAgentChats ────────────────────────────────────────────────────────

	readonly chats: IAgentChats = {
		createChat: async (chat: URI, _context: AgentChatOperationContext, options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void> => {
			const createT0 = Date.now(); // test-workbench_change — 耗时埋点
			// test-workbench_change - 新上游 fork 并入 createChat(options.fork)
			if (options?.fork) {
				return this._createForkedChat(chat, options.fork, options.config);
			}
			const connT0 = Date.now(); // test-workbench_change — 耗时埋点
			const ready = await this._ensureConnection();
			// test-workbench_change start — 耗时埋点:连接等待(冷启动在此计入,>50ms 才提示,避免噪声)
			if (Date.now() - connT0 > 50) {
				this._logService.info(`[耗时][连接等待] createChat→_ensureConnection 等待后端就绪 = ${Date.now() - connT0}ms;时间消耗类型 =「冷启动等待,若伴随后端冷启动日志则为同一段」`);
			}
			// test-workbench_change end
			// 新上游:session URI 由 orchestrator mint,provider 不得自造(signal 会寻址失败)
			const sessionUri = OpenCodeAgent._hostSessionUri(chat);
			const sessionId = AgentSession.id(sessionUri);

			const workingDirectory = (Array.isArray(options?.workingDirectories) ? options?.workingDirectories[0] : options?.workingDirectories) // test-workbench_change - 新上游字段为复数
				?? URI.file('/tmp/testagent-' + sessionId);
			try { fs.mkdirSync(workingDirectory.fsPath, { recursive: true }); } catch { /* ignore */ }

			this._sessions.deleteAndDispose(sessionId);
			const session = new OpenCodeSession(
				sessionId, sessionUri,
				ready.baseUrl, ready.authHeader,
				this._onDidSessionProgress,
				this._logService,
				chat, // test-workbench_change - host 指定的 chat 决定 signal 寻址
			);
			this._sessions.set(sessionId, session);
			session.setWorkingDirectory(workingDirectory); // test-workbench_change — customizations 清单用
			this._bindSessionCustomizations(session, workingDirectory); // test-workbench_change — turn 结束广播+目录监听
			session.onSessionCreated = (opencodeSessionId) => { // test-workbench_change - 持久化 host session → opencode 会话映射(跨重启恢复)
				this._rememberOpencodeId(sessionId, opencodeSessionId);
			};
			this._peerChatSessions.set(chat.toString(), session);
			// test-workbench_change start — provisional(预warm草稿)契约:普通新 chat(非 fork/
			// 非 import)只建内存占位并返回 provisional:true,orchestrator 会将其隐藏(sessionAdded/
			// SessionReady 推迟到首次 sendMessage materialize)。否则 UI 预热的 untitled 草稿会
			// 每个都 POST /session/ 并泄漏进 sessions 列表(「点进历史会话再退出多一条」的根因)。
			const provisional = !options?.fork && !options?.importConversation;
			session.isProvisional = provisional;
			// test-workbench_change end
			await session.initialize();
			if (options?.model) { session.setModel(options.model); }
			if (options?.agent) { session.setAgent(OpenCodeAgent._agentNameFromUri(options.agent.uri)); } // test-workbench_change
			if (provisional) {
				this._logService.info(`[TestAgent] chat created (provisional): ${chat.toString()};时间消耗类型 =「草稿占位,无后端会话,首条消息发送时才建立」`); // test-workbench_change — 耗时埋点
				return { provisional: true };
			}
			this._logService.info(`[TestAgent] chat created: ${chat.toString()} (opencode: ${session.opencodeSessionId})`);
			this._logService.info(`[耗时][会话创建] createChat 全链路(含冷启动等待+会话建立) = ${Date.now() - createT0}ms;时间消耗类型 =「新建 chat 后、首条消息发出前的一次性固定开销」`); // test-workbench_change — 耗时埋点
			// providerData 统一为 fork opencode 会话 ID:materializeChat 按它重挂
			// (fork 的 POST /session 不允许指定 ID,只能用返回值登记)。 // test-workbench_change
			// test-workbench_change start — 返回 backingSession(I7):本 opencode 会话
			// 不得作为顶层 session 泄漏到 listSessions/discovery。
			return {
				providerData: session.opencodeSessionId,
				backingSession: session.opencodeSessionId
					? AgentSession.uri(this.id, session.opencodeSessionId)
					: undefined,
			};
			// test-workbench_change end
		},
		disposeChat: async (chat: URI, _context: AgentChatOperationContext): Promise<void> => {
			const session = this._peerChatSessions.get(chat.toString());
			if (!session) {
				// test-workbench_change — subagent backing 也要随 host removeChat 清理
				if (isSubagentChatUri(chat)) {
					const parsedSub = parseChatUri(chat);
					const parent = parsedSub ? this._resolveSessionByUri(URI.parse(parsedSub.session)) : undefined;
					parent?.removeSubagentSession(chat);
				}
				return;
			}
			this._peerChatSessions.delete(chat.toString());
			try {
				const ready = await this._ensureConnection();
				if (session.opencodeSessionId) {
					await this._request(ready, 'DELETE', `/session/${session.opencodeSessionId}`);
				}
			} catch { /* ignore */ }
			this._sessions.deleteAndDispose(AgentSession.id(session.sessionUri));
			this._forgetOpencodeId(AgentSession.id(session.sessionUri)); // test-workbench_change
		},
		// test-workbench_change start - 新上游要求 chat 级非破坏性释放
		canReleaseChat: async (chat: URI): Promise<boolean> => {
			const session = this._resolveSession(chat);
			return !!session && !session.hasActiveTurn;
		},
		releaseChat: async (chat: URI, context: AgentChatOperationContext): Promise<void> => {
			if (this._peerChatSessions.has(chat.toString())) {
				const session = this._peerChatSessions.get(chat.toString());
				if (session && !session.hasActiveTurn) {
					this._peerChatSessions.delete(chat.toString());
					this._sessions.deleteAndDispose(session.sessionId);
				}
				return;
			}
			const parsed = parseChatUri(chat);
			return this.releaseSession(parsed ? URI.parse(parsed.session) : (URI.isUri(context) ? context : chat));
		},
		// test-workbench_change end
		sendMessage: async (chat: URI, prompt: string, workingDirectoriesOrDirectory: readonly URI[] | URI | undefined, attachments?: readonly MessageAttachment[], turnId?: string, _senderClientId?: string): Promise<void> => {
			const session = this._resolveSession(chat);
			if (!session) {
				throw new Error(`TestAgent session not found for chat ${chat.toString()}`);
			}
			// test-workbench_change start — provisional 草稿首条消息:先 materialize 真实
			// opencode 会话,再 fire onDidMaterializeChat 让 orchestrator 补发 sessionAdded/
			// SessionReady、持久化 providerData 与 backingSession(I7)标记,之后正常发送。
			if (session.isProvisional) {
				const materializeT0 = Date.now();
				await session.materialize();
				this._logService.info(`[耗时][会话建立] provisional materialize(首条消息触发 POST /session/)= ${Date.now() - materializeT0}ms;时间消耗类型 =「草稿升级为真实 TestAgent 会话,计入首条消息延迟,后续消息不再发生」`);
				this._onDidMaterializeChat.fire({
					chat: session.chatChannelUri,
					result: {
						providerData: session.opencodeSessionId,
						backingSession: session.opencodeSessionId ? AgentSession.uri(this.id, session.opencodeSessionId) : undefined,
					},
					workingDirectories: session.currentWorkingDirectory ? [session.currentWorkingDirectory] : undefined,
					project: undefined,
				});
			}
			// test-workbench_change end
			// test-workbench_change - 新上游传完整工作目录快照(index 0 = 主根),opencode 后端只支持单根
			const workingDirectory = Array.isArray(workingDirectoriesOrDirectory)
				? workingDirectoriesOrDirectory[0]
				: workingDirectoriesOrDirectory;
			const toolNames = this._getEnabledToolNames(chat);
			await session.sendMessage(prompt, workingDirectory, attachments, turnId, toolNames);
		},
		abort: async (chat: URI): Promise<void> => {
			const session = this._resolveSession(chat);
			if (session) { session.abort(); }
		},
		// test-workbench_change start — Try Again:转发到 session.resumeTurn(以原 turnId 重发)
		resumeTurn: async (chat: URI, turnId: string): Promise<void> => {
			const session = this._resolveSession(chat);
			if (!session) {
				throw new Error(`TestAgent session not found for chat ${chat.toString()}`);
			}
			await session.resumeTurn(turnId);
		},
		// test-workbench_change end
		changeModel: async (chat: URI, model: ModelSelection): Promise<void> => {
			const session = this._resolveSession(chat);
			if (!session) {
				throw new Error(`TestAgent session not found for chat ${chat.toString()}`);
			}
			session.setModel(model);
		},
		changeAgent: async (chat: URI, agent: AgentSelection | undefined): Promise<void> => {
			// test-workbench_change — 之前是空实现,选择器选了 plan 后端仍跑默认 build agent
			const session = this._resolveSession(chat);
			this._logService.info(`[TestAgent] changeAgent chat=${chat.toString()} agent=${agent ? OpenCodeAgent._agentNameFromUri(agent.uri) : '(default)'} resolved=${!!session}`);
			session?.setAgent(agent ? OpenCodeAgent._agentNameFromUri(agent.uri) : undefined);
		},
		getMessages: async (chat: URI, context: AgentChatOperationContext): Promise<readonly Turn[]> => {
			let session = this._resolveSession(chat);
			// test-workbench_change start — 冷恢复 subagent chat:host 的 _doRestoreSubagentChat
			// 直接调 getMessages(不经 materializeChat)。子 backing 未登记时 _resolveSession 落空,
			// 此前返回 [] → host 判定无内容、不 addChat → 打开 subagent tab 报 "Couldn't open
			// session"。复用 materializeChat 的 subagent 自举(重挂父会话 + materializeSubagent
			// 登记子 backing)后再读历史。仅对 subagent chat 触发,普通/peer/fork chat 行为不变。
			if (!session && isSubagentChatUri(chat)) {
				await this.materializeChat(chat, context, undefined);
				session = this._resolveSession(chat);
			}
			// test-workbench_change end
			if (!session) { return []; }
			return session.getMessages();
		},
	};

	// ── Session lifecycle ──────────────────────────────────────────────────

	async createSession(config: IAgentCreateSessionConfig = {}): Promise<IAgentCreateSessionResult> {
		const createT0 = Date.now(); // test-workbench_change — 耗时埋点
		const connT0 = Date.now(); // test-workbench_change — 耗时埋点
		const ready = await this._ensureConnection();
		// test-workbench_change start — 耗时埋点:冷启动等待
		if (Date.now() - connT0 > 50) {
			this._logService.info(`[耗时][连接等待] createSession→_ensureConnection 等待后端就绪 = ${Date.now() - connT0}ms;时间消耗类型 =「冷启动等待,用户视角的新会话首屏空白段」`);
		}
		// test-workbench_change end
		const sessionId = config.session ? AgentSession.id(config.session) : generateUuid();
		const sessionUri = AgentSession.uri(this.id, sessionId);

		this._sessions.deleteAndDispose(sessionId);

		// test-workbench_change - 新上游字段改为复数 workingDirectories(opencode 单根取 index 0)
		const workingDirectory = config.workingDirectories?.[0]
			?? URI.file('/tmp/testagent-' + sessionId);

		// 默认工作目录是合成的(/tmp/testagent-<sessionId>),并不真实存在;
		// 必须创建它,否则持久化会话在恢复时会被
		// WorktreeIsolation.resolveWorkingDirectoryForResume 判定为缺失,
		// 抛出 SessionWorkingDirectoryMissingError。 // test-workbench_change
		if (!config.workingDirectories) {
			try {
				fs.mkdirSync(workingDirectory.fsPath, { recursive: true });
			} catch (err) {
				this._logService.warn(`[TestAgent] failed to create default working directory ${workingDirectory.fsPath}: ${err}`);
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
		session.setWorkingDirectory(workingDirectory); // test-workbench_change — customizations 清单用
		this._bindSessionCustomizations(session, workingDirectory); // test-workbench_change — turn 结束广播+目录监听
		if (config.agent) { session.setAgent(OpenCodeAgent._agentNameFromUri(config.agent.uri)); } // test-workbench_change — 新会话首条消息的 agent 选择走 createSession,不经 changeAgent
		await session.initialize();
		this._logService.info(`[耗时][会话创建] createSession 全链路(含冷启动等待+会话建立) = ${Date.now() - createT0}ms;时间消耗类型 =「新 session 首条消息前的固定开销(与 [后端冷启动]/[会话建立] 分段对应)」`); // test-workbench_change — 耗时埋点

		return { session: sessionUri, resolvedWorkingDirectory: workingDirectory }; // test-workbench_change - 新上游字段名为 resolvedWorkingDirectory
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
		if (!session) { return; }
		// test-workbench_change start — 级联销毁:同属该 AH session 的 peer/fork backing
		// 一并 DELETE + dispose,不留悬挂路由(subagent 子 backing 随父 session dispose)。
		const ready = await this._ensureConnection();
		const uriStr = sessionUri.toString();
		for (const [key, s] of [...this._sessions]) {
			if (s.sessionUri.toString() !== uriStr) { continue; }
			try {
				await this._request(ready, 'DELETE', `/session/${s.opencodeSessionId ?? key}`);
			} catch { /* ignore */ }
			this._sessions.deleteAndDispose(key);
			this._toolSets.delete(key);
		}
		for (const [chatStr, s] of [...this._peerChatSessions]) {
			if (s.sessionUri.toString() === uriStr) { this._peerChatSessions.delete(chatStr); }
		}
		// test-workbench_change end
		this._forgetOpencodeId(sessionId); // 同步清掉持久化映射,避免恢复时重挂已删会话
	}

	/**
	 * 会话恢复时重挂 peer chat 的 fork 会话(按 createChat/fork 持久化的
	 * providerData,即 opencode 会话 ID)。与 createChat 一致:每个 peer chat
	 * 拥有独立伪 session,`_peerChatSessions` 按 chat URI 索引保证
	 * `_resolveSession` 命中。Best-effort:fork 会话已删除/不可达时记日志并
	 * 降级为"有历史、无 live backing",不抛出(orchestrator 协议约定)。
	 */
	async materializeChat(chat: URI, context: AgentChatOperationContext, providerData: string | undefined): Promise<IAgentCreateChatResult | void> {
		// test-workbench_change start — subagent chat:host 重订阅时从父 transcript 找回
		// task call 的子会话 id 并重挂(providerData 缺失走该派生路径)。
		if (isSubagentChatUri(chat)) {
			const parsedSub = parseChatUri(chat);
			const toolCallId = parsedSub?.chatId.startsWith('subagent/')
				? decodeURIComponent(parsedSub.chatId.slice('subagent/'.length))
				: undefined;
			if (!parsedSub || !toolCallId) { return; }
			const parentUri = URI.parse(parsedSub.session);
			let parent = this._resolveSessionByUri(parentUri);
			if (!parent) {
				// 父 default chat 也冷着:先按持久化映射重挂父会话
				const parentOpencodeId = providerData ?? this._getOpencodeId(AgentSession.id(parentUri));
				await this.materializeChat(URI.parse(buildDefaultChatUri(parentUri)), context, parentOpencodeId);
				parent = this._resolveSessionByUri(parentUri);
			}
			if (!parent) {
				this._logService.warn(`[TestAgent] materializeChat(subagent): parent session not restorable for ${chat.toString()}`);
				return;
			}
			const child = await parent.materializeSubagent(chat, toolCallId);
			if (child?.opencodeSessionId) {
				return { providerData: child.opencodeSessionId, backingSession: AgentSession.uri(this.id, child.opencodeSessionId) };
			}
			return;
		}
		// test-workbench_change end
		// test-workbench_change start - 新上游:恢复时默认 chat 与 peer chat 的重挂统一走这里
		const sessionUri = OpenCodeAgent._hostSessionUri(chat);
		const sessionId = AgentSession.id(sessionUri);
		const isDefault = isDefaultChatUri(chat);
		if (isDefault ? this._sessions.has(sessionId) : this._peerChatSessions.has(chat.toString())) { return; }

		const opencodeId = providerData ?? (isDefault ? this._getOpencodeId(sessionId) : undefined);
		if (opencodeId === undefined) {
			this._logService.warn(`[TestAgent] materializeChat: no providerData for ${chat.toString()}; chat restores with history but no live backing`);
			return;
		}
		try {
			const ready = await this._ensureConnection();
			// 验证 opencode 侧会话仍存在(拿到规范 ID),不存在则降级
			const info = await this._request<{ id: string }>(ready, 'GET', `/session/${opencodeId}`);
			const canonicalId = info.id ?? opencodeId;
			const backingId = isDefault ? sessionId : sessionId + '-fork-' + generateUuid().slice(0, 8);
			const session = new OpenCodeSession(
				backingId, sessionUri,
				ready.baseUrl, ready.authHeader,
				this._onDidSessionProgress,
				this._logService,
				chat,
			);
			session.opencodeSessionId = canonicalId;
			this._sessions.set(backingId, session);
			this._bindSessionCustomizations(session, undefined); // test-workbench_change — turn 结束广播+用户级目录监听
			if (isDefault) {
				this._rememberOpencodeId(sessionId, canonicalId);
			} else {
				this._peerChatSessions.set(chat.toString(), session);
			}
			this._logService.info(`[TestAgent] chat materialized: ${chat.toString()} (backend: ${canonicalId})`);
			// test-workbench_change - 恢复路径同样标记 backingSession(I7)
			return { providerData: canonicalId, backingSession: AgentSession.uri(this.id, canonicalId) };
		} catch (err) {
			this._logService.warn(`[TestAgent] materializeChat failed for ${chat.toString()}: ${err}`);
		}
		// test-workbench_change end
	}

	// ── Permissions ────────────────────────────────────────────────────────

	// test-workbench_change start — 外部会话发现 + 注册迁移。与 Claude/Codex 同构:
	// 枚举 opencode 原生 catalog,registry/本 provider 已知的不报,其余以 external
	// provenance 推入 onDidDiscoverChats;listChatsToMigrate 返回 known 半。
	// lazy 语义:后端未连接时返回 undefined(“尚未能枚举”,非权威空),首次
	// _ensureConnection 建立后由 _emitOpenCodeChats 补发。
	setKnownSessionsFilter(filter: IAgentKnownSessionsFilter): void {
		this._knownSessionsFilter = filter;
	}

	startChatDiscovery(): Promise<void> {
		this._chatDiscoveryRequested = true;
		if (this._connection.kind === 'ready' && !this._chatDiscoveryDone) {
			void this._emitOpenCodeChats();
		}
		return Promise.resolve();
	}

	/** 枚举 opencode 原生 session catalog;undefined = catalog 此刻不可枚举。 */
	private async _listOpenCodeChats(): Promise<IAgentChatMetadata[] | undefined> {
		if (this._connection.kind !== 'ready') { return undefined; }
		const ready = this._connection;
		try {
			const sessionList = await this._request<Array<{
				id: string; title?: string; slug?: string; parentID?: string;
				directory?: string; time?: { created?: number; updated?: number; archived?: number | null };
			}>>(ready, 'GET', '/session/');
			const now = Date.now();
			return sessionList
				// task/subagent 派生的子会话与归档会话不作为顶层 external session 浮现
				.filter(s => !s.parentID && s.time?.archived === undefined)
				.map(s => {
					const chat = URI.parse(buildDefaultChatUri(AgentSession.uri(this.id, s.id)));
					return {
						chat,
						startTime: s.time?.created ?? now,
						modifiedTime: s.time?.updated ?? s.time?.created ?? now,
						summary: s.title || s.slug,
						workingDirectories: s.directory ? [URI.file(s.directory)] : undefined,
					} satisfies IAgentChatMetadata;
				});
		} catch (err) {
			this._logService.warn(`[TestAgent] native session catalog failed: ${err}`);
			return undefined;
		}
	}

	/** registry 命中 + 本 provider 自有 backing(default/peer/fork/subagent)都算 known。 */
	private async _knownChatSessionKeys(chats: readonly IAgentChatMetadata[]): Promise<ReadonlySet<string>> {
		const sessionOf = (chat: IAgentChatMetadata): string | undefined => parseChatUri(chat.chat)?.session;
		const known = new Set<string>();
		if (this._knownSessionsFilter) {
			const uris = chats
				.map(c => { const s = sessionOf(c); return s ? URI.parse(s) : undefined; })
				.filter((s): s is URI => !!s);
			const registered = await this._knownSessionsFilter(uris);
			for (const key of registered) { known.add(key); }
		}
		// registry 里只有父 AH session;本 provider 建过的 opencode 会话(含 peer/fork
		// backing 与跨重启映射)从不是外部会话。
		const local = this._localOpencodeIds();
		for (const chat of chats) {
			const session = sessionOf(chat);
			if (session && local.has(AgentSession.id(URI.parse(session)))) {
				known.add(session);
			}
		}
		return known;
	}

	private _localOpencodeIds(): ReadonlySet<string> {
		const ids = new Set<string>();
		for (const [, s] of this._sessions) {
			if (s.opencodeSessionId) { ids.add(s.opencodeSessionId); }
		}
		if (!this._sessionMap) { this._sessionMap = this._loadSessionMap(); }
		for (const opencodeId of Object.values(this._sessionMap)) { ids.add(opencodeId); }
		return ids;
	}

	private async _emitOpenCodeChats(): Promise<void> {
		const chats = await this._listOpenCodeChats();
		if (!chats) { return; }
		try {
			const known = await this._knownChatSessionKeys(chats);
			this._chatDiscoveryDone = true;
			this._onDidDiscoverChats.fire(chats.map(chat => {
				const session = parseChatUri(chat.chat)?.session;
				return { ...chat, external: !(session && known.has(session)) };
			}));
		} catch (err) {
			this._logService.warn(`[TestAgent] failed to emit discovered chats: ${err}`);
		}
	}

	async listChatsToMigrate(): Promise<AgentChatMigrationResult> {
		// 后端从未启动:Deferred(不得以空 catalog 推进迁移标记),等首次使用触发。
		if (!this._backendActivated) { return AgentChatMigrationDeferred; }
		const chats = await this._listOpenCodeChats();
		if (!chats) { return undefined; }
		const known = await this._knownChatSessionKeys(chats);
		return chats.filter(c => {
			const session = parseChatUri(c.chat)?.session;
			return !!session && known.has(session);
		});
	}
	// test-workbench_change end

	async getChatMetadata(chat: URI, _context: AgentChatOperationContext, providerData?: string, options?: IAgentChatMetadataOptions): Promise<IAgentChatMetadata | undefined> {
		const parsed = parseChatUri(chat);
		const sessionUri = parsed ? URI.parse(parsed.session) : chat;
		const sessionId = AgentSession.id(sessionUri);
		const now = Date.now();
		const fallback = options?.registryFallback;
		const opencodeId = providerData
			?? this._sessions.get(sessionId)?.opencodeSessionId
			?? this._peerChatSessions.get(chat.toString())?.opencodeSessionId
			?? this._getOpencodeId(sessionId);
		if (!opencodeId) { return undefined; }
		try {
			const ready = await this._ensureConnection();
			// test-workbench_change start — 对齐 Codex:metadata 必须携带 workingDirectories 与
			// model,否则 listSessions hydration / 外部会话 restore 解析不出工作根
			// (SessionWorkingDirectoryMissingError),模型选择也不随恢复。
			const info = await this._request<{
				id?: string; title?: string; slug?: string; directory?: string;
				model?: { id?: string; providerID?: string };
				time?: { created?: number; updated?: number };
			}>(ready, 'GET', `/session/${opencodeId}`);
			return {
				chat,
				startTime: info.time?.created ?? fallback?.startTime ?? now,
				modifiedTime: info.time?.updated ?? fallback?.modifiedTime ?? now,
				summary: info.title ?? info.slug,
				workingDirectories: info.directory ? [URI.file(info.directory)] : undefined,
				model: info.model?.id && info.model.providerID
					? { id: `${info.model.providerID}/${info.model.id}` }
					: undefined,
			};
			// test-workbench_change end
		} catch {
			return {
				chat,
				startTime: fallback?.startTime ?? now,
				modifiedTime: fallback?.modifiedTime ?? now,
			};
		}
	}
	// test-workbench_change end

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
		// test-workbench_change start — 级联释放整个 AH session 的 backing(default + peer/fork
		// 独立 session 都以同一 sessionUri 归属;此前只删 default,peer backing 留在
		// _sessions/_peerChatSessions 里成为 dispose 后的悬挂路由)。任一 backing
		// 有活跃 turn 时整体不释放。
		const uriStr = session.toString();
		for (const [, s] of this._sessions) {
			if (s.sessionUri.toString() === uriStr && s.hasActiveTurn) { return; }
		}
		for (const [key, s] of [...this._sessions]) {
			if (s.sessionUri.toString() === uriStr) {
				this._sessions.deleteAndDispose(key);
				this._toolSets.delete(key);
			}
		}
		for (const [chatStr, s] of [...this._peerChatSessions]) {
			if (s.sessionUri.toString() === uriStr) { this._peerChatSessions.delete(chatStr); }
		}
		// test-workbench_change end
		this._logService.info(`[TestAgent] released idle session ${sessionId} (opencode: ${opencodeSession.opencodeSessionId ?? '?'})`);
	}

	// test-workbench_change start - 新上游 IAgent:工作目录经 chat 寻址,opencode 后端单根
	async setWorkingDirectory(chat: URI, _context: AgentChatOperationContext, workingDirectory: URI): Promise<void> {
		this._resolveSession(chat)?.setWorkingDirectory(workingDirectory);
	}
	// test-workbench_change end

	respondToPermissionRequest(_requestId: string, _approved: boolean): void {
		// test-workbench_change start — 必须展开后代 subagent backing:子会话内工具的 permission
		// 应答此前只广播到顶层 _sessions,子 backing 收不到 → 子会话权限卡死。owner 去重保证
		// 仅登记该 requestId 的 backing 真正回包。
		for (const [, s] of this._sessions) {
			s.respondToPermissionRequest(_requestId, _approved);
			for (const child of s.iterateSubagentBackings()) { child.respondToPermissionRequest(_requestId, _approved); }
		}
		// test-workbench_change end
	}

	respondToUserInputRequest(requestId: string, response: ChatInputResponseKind, answers?: Record<string, ChatInputAnswer>): void {
		// test-workbench_change start — 同上:子会话内 question 的应答需展开后代 backing,
		// 否则用户回答子会话的 question 永远传不回 opencode 后端(截图「Running question」卡死)。
		for (const [, s] of this._sessions) {
			s.respondToUserInputRequest(requestId, response, answers);
			for (const child of s.iterateSubagentBackings()) { child.respondToUserInputRequest(requestId, response, answers); }
		}
		// test-workbench_change end
	}

	// ── Configuration ──────────────────────────────────────────────────────

	// test-workbench_change start - 新上游方法改名:resolveSessionConfig→resolveChatConfig 等。
	// test-workbench_change — 需求:审批完全由 TestAgent 自身配置(testagent.jsonc)决定,
	// 不再广告 permissionMode 会话档位(无 picker/chip),host 永不 PATCH 会话级 ruleset。
	resolveChatConfig(_params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult> {
		return Promise.resolve({ schema: [], values: {} });
	}

	getInheritedChatConfig(_config: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
		return undefined;
	}

	chatConfigCompletions(_params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		// 无动态配置候选
		return Promise.resolve({ items: [] });
	}

	/**
	 * 历史截断(与 host 已应用的 ChatTruncated 对齐):保留至 turnId,
	 * 删除其后的后端消息;turnId undefined = 全清。opencode 消息删除不
	 * 回滚文件(host 侧 checkpoint service 负责 discard),与 Codex
	 * thread/rollback 的截断语义一致。 // test-workbench_change
	 */
	async truncateChat(chat: URI, turnId: string | undefined, _context?: AgentChatOperationContext): Promise<void> {
		const session = this._resolveSession(chat);
		if (!session) {
			this._logService.warn(`[TestAgent] truncateChat: no backing for ${chat.toString()}; skipping`);
			return;
		}
		await session.truncate(turnId);
	}
	// test-workbench_change end

	// ── Client tools ───────────────────────────────────────────────────────

	getOrCreateActiveClient(chat: URI, _context: AgentChatOperationContext, client: { readonly clientId: string; readonly displayName?: string }, _hostCustomizations?: readonly Customization[]): IActiveClient { // test-workbench_change - chat-addressed
		const sessionKey = this._sessionKeyForChat(chat);
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

	removeActiveClient(chat: URI, _context: AgentChatOperationContext, clientId: string): void { // test-workbench_change - chat-addressed
		this._toolSets.get(this._sessionKeyForChat(chat))?.delete(clientId);
	}

	onClientToolCallComplete(_chat: URI, _toolCallId: string, _result: ToolCallResult, _context?: AgentChatOperationContext): void { } // test-workbench_change - 新签名

	// test-workbench_change start - chat URI → 归属 session key(peer chat 若无映射则自成一组)
	private _sessionKeyForChat(chat: URI): string {
		const peer = this._peerChatSessions.get(chat.toString());
		if (peer) { return peer.sessionId; }
		const parsed = parseChatUri(chat);
		const sessionUri = parsed ? URI.parse(parsed.session) : chat;
		return AgentSession.id(sessionUri);
	}
	// test-workbench_change end

	private _getEnabledToolNames(chatUri: URI): string[] {
		const sessionKey = this._sessionKeyForChat(chatUri);
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
			OpenCodeAgent._killBackend(this._connection.child); // test-workbench_change
		}
		this._connection = { kind: 'idle' };
	}

	// ── Private ────────────────────────────────────────────────────────────

	private _resolveSession(chatUri: URI): IOpenCodeSession | undefined {
		// 多 chat 支持:peer chat 优先按 chat URI 匹配独立的 OpenCodeSession
		const peer = this._peerChatSessions.get(chatUri.toString());
		if (peer) { return peer; }

		// test-workbench_change start — subagent chat:只读 backing 挂在父 session 下;
		// 不可回落到父 backing(会把父 transcript 冒充子会话历史)。冷态由
		// materializeChat 的 subagent 分支重挂,这里 miss 就返回 undefined。
		if (isSubagentChatUri(chatUri)) {
			const parsedSub = parseChatUri(chatUri);
			if (parsedSub) {
				for (const [, s] of this._sessions) {
					if (s.sessionUri.toString() === parsedSub.session) {
						const child = s.getSubagentSession(chatUri);
						if (child) { return child; }
					}
				}
			}
			return undefined;
		}
		// test-workbench_change end

		const parsed = parseChatUri(chatUri);
		const sessionUri = parsed ? URI.parse(parsed.session) : chatUri;
		for (const [, s] of this._sessions) {
			if (s.sessionUri.toString() === sessionUri.toString()) {
				return s;
			}
		}
		return undefined;
	}

	// test-workbench_change start - 新上游 fork 经由 createChat(options.fork) 进入
	private async _createForkedChat(chat: URI, source: IAgentCreateChatForkSource, config?: Record<string, unknown>): Promise<IAgentCreateChatResult | void> {
		const sourceSession = this._resolveSession(source.source);
		if (!sourceSession) {
			throw new Error(`TestAgent source session not found for fork: ${source.source.toString()}`);
		}
		const ready = await this._ensureConnection();
		// source.turnId 为 host turn id 时由 session 内部翻译为 fork 锚点消息 // test-workbench_change
		const forkedId = await sourceSession.fork(source.turnId);

		// fork 返回的是已创建好的 opencode 会话;session URI 沿用 host 分配的(fork chat 归属同一 session)
		const sessionUri = OpenCodeAgent._hostSessionUri(chat);
		const sessionId = AgentSession.id(sessionUri) + '-fork-' + generateUuid().slice(0, 8);
		const session = new OpenCodeSession(
			sessionId, sessionUri,
			ready.baseUrl, ready.authHeader,
			this._onDidSessionProgress,
			this._logService,
			chat, // test-workbench_change - host 指定的 chat 决定 signal 寻址
		);
		session.opencodeSessionId = forkedId;

		// test-workbench_change start — 对齐 Codex fork 语义:新 chat 继承源会话的工作目录、
		// 模型与 agent 选择(此前落到合成 /tmp 目录,首条消息会写进错误 workspace)。
		const workingDirectory = sourceSession.currentWorkingDirectory
			?? URI.file('/tmp/testagent-' + sessionId);
		try { fs.mkdirSync(workingDirectory.fsPath, { recursive: true }); } catch { /* ignore */ }
		session.setWorkingDirectory(workingDirectory);
		this._bindSessionCustomizations(session, workingDirectory); // test-workbench_change — turn 结束广播+目录监听
		if (sourceSession.modelOverride) { session.setModel(sourceSession.modelOverride); }
		if (sourceSession.agentName) { session.setAgent(sourceSession.agentName); }
		// test-workbench_change end
		this._sessions.set(sessionId, session);
		this._peerChatSessions.set(chat.toString(), session); // test-workbench_change — fork 目标 chat 需可寻址
		this._logService.info(`[TestAgent] forked chat ${chat.toString()} (backend: ${forkedId})`);

		// test-workbench_change start — backingSession 标记 fork backing,防 I7 泄漏
		return {
			providerData: forkedId,
			backingSession: AgentSession.uri(this.id, forkedId),
		};
		// test-workbench_change end
	}

	/** 从 host 分配的 chat channel URI 反解其归属 session URI(默认与 peer chat 均适用)。 */
	private static _hostSessionUri(chat: URI): URI {
		const parsed = parseChatUri(chat);
		return parsed ? URI.parse(parsed.session) : chat;
	}
	// test-workbench_change end

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
			// test-workbench_change — 后端已激活:补发此前 lazy 挂起的外部会话发现
			this._backendActivated = true;
			if (this._chatDiscoveryRequested && !this._chatDiscoveryDone) { void this._emitOpenCodeChats(); }
			return ready;
		}).catch(err => {
			this._connection = { kind: 'idle' };
			throw err;
		});
		this._connection = { kind: 'starting', promise };
		return promise;
	}

	// test-workbench_change start
	// 后端二进制解析顺序：OPENCODE_BIN 显式覆盖 > node 运行时 wrapper（testagent-node[.cmd]，
	// 优先查 kilo-vscode 扩展 env-path.ts 写入的 TestAgent 环境变量目录，再按 PATH 查找）> testagent（bun 版，PATH）。
	private _resolveBackendBin(): string {
		const override = process.env['OPENCODE_BIN'];
		if (override) {
			return override;
		}
		const names = process.platform === 'win32'
			? ['testagent-node.cmd', 'testagent-node.exe', 'testagent-node']
			: ['testagent-node'];
		const dirs = [
			process.env['TestAgent'],
			...(process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':'),
		].filter(Boolean) as string[];
		for (const dir of dirs) {
			for (const name of names) {
				const candidate = join(dir, name);
				if (fs.existsSync(candidate)) {
					return candidate;
				}
			}
		}
		return 'testagent';
	}
	// test-workbench_change end

	private _startConnection(): Promise<ConnectionReady> {
		return new Promise<ConnectionReady>((resolve, reject) => {
			const args = ['serve', '--port=0'];
			const env: NodeJS.ProcessEnv = { ...process.env };

			// 后端二进制解析：优先 node 运行时 wrapper，回退 bun 版 // test-workbench_change
			const bin = this._resolveBackendBin();

			this._logService.info(`[TestAgent] spawning ${bin} serve --port=0`);

			// test-workbench_change start: node 运行时 wrapper 是 .cmd，win32 下 spawn 需 shell:true；exe 走原路径。
			// shell:true 时 cmd.exe 按空格切分命令行，含空格路径必须自行加引号，否则报"不是内部或外部命令"退出码 1。
			const useCmdShell = process.platform === 'win32' && !/\.exe$/i.test(bin);
			const child = cp.spawn(useCmdShell ? `"${bin}"` : bin, args, {
				env,
				stdio: ['pipe', 'pipe', 'pipe'],
				...(useCmdShell ? { shell: true } : {}),
			});
			// test-workbench_change end
			this._guardBackendProcessLifecycle(child); // test-workbench_change

			const authHeader = this._getAuthHeader();
			let resolved = false;
			const spawnStart = Date.now(); // test-workbench_change — 耗时埋点

			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					OpenCodeAgent._killBackend(child); // test-workbench_change
					reject(new Error('TestAgent backend process failed to start within timeout'));
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
					// test-workbench_change start — 耗时埋点:testagent 冷启动一次性开销
					this._logService.info(`[耗时][后端冷启动] spawn(${bin})→stdout 报告监听地址 = ${Date.now() - spawnStart}ms;时间消耗类型 =「testagent 进程+Bun/Node 运行时+server 初始化,整链路最重的一次性开销(超时上限 30s),仅首次操作支付,首个发送若撞上 starting 状态会被它阻塞」`);
					// test-workbench_change end
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
				this._logService.warn(`[TestAgent] process exited code=${code} signal=${signal}`);
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					reject(new Error(`TestAgent backend process exited early with code ${code}`));
				}
				if (this._connection.kind === 'ready') {
					this._handleConnectionLost();
				}
			});
		});
	}

	// test-workbench_change start
	// VS Code 退出时以 SIGTERM(POSIX)或直接 TerminateProcess(Windows)结束 agent host，默认行为不走
	// OpenCodeAgent.shutdown()，spawn 出的 testagent 会变孤儿。这里兜底当前存活的后端进程：
	// 捕获 SIGTERM/SIGINT 与进程 exit，同步 kill。
	// win32 下后端可能是 .cmd wrapper（shell:true spawn），child.kill() 只杀 cmd.exe，
	// node 孙进程会成孤儿；统一用 taskkill /T 杀整棵进程树。
	private _backendChild: cp.ChildProcess | undefined;
	private static _backendSignalGuardsInstalled = false;

	private static _killBackend(child: cp.ChildProcess | undefined): void {
		if (!child || child.pid === undefined) { return; }
		if (process.platform === 'win32') {
			try { cp.execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* already exited */ }
		} else {
			// test-workbench_change — SIGKILL 而非 SIGTERM:testagent 的 serve 可能捕获 SIGTERM
			// 做 graceful shutdown 而卡住不退(尤其有活跃 SSE 连接时),导致 agentHost 退出后
			// 它成孤儿。关闭/超时场景无优雅需求,与 win32 的 taskkill /F 对称强杀。
			try { child.kill('SIGKILL'); } catch { /* already exited */ }
		}
	}

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
		const killBackend = () => { OpenCodeAgent._killBackend(this._backendChild); }; // test-workbench_change
		const onSignal = () => { killBackend(); process.exit(0); };
		process.on('SIGTERM', onSignal);
		process.on('SIGINT', onSignal);
		process.once('exit', killBackend);
	}
	// test-workbench_change end

	private _handleConnectionLost(): void {
		this._logService.warn('[TestAgent] connection lost');
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
		// test-workbench_change start — subagent 只读 backing 不在顶层 _sessions(挂在父 session
		// 的 _subagentSessions 下),SSE 按子会话 opencode id 推送的事件此前路由不到 → 子会话
		// live 内容全丢。顶层未命中时递归查各 session 的子 backing。
		for (const [, s] of this._sessions) {
			const child = s.findSubagentByOpencodeId(opencodeSessionId);
			if (child) { return child; }
		}
		// test-workbench_change end
		return undefined;
	}

	// ── Customizations ──────────────────────────────────────────────────────

	// test-workbench_change start
	/** 从 AgentSelection.uri 提取 agent 名:兼容 discovery 合成 uri 与文件 uri(取末段去 .md) */
	private static _agentNameFromUri(uri: string): string {
		const seg = /\/([^/]+?)(?:\.md)?$/.exec(uri.split('?')[0])?.[1];
		return seg ? decodeURIComponent(seg) : uri;
	}
	// test-workbench_change end

	// test-workbench_change start — Skills/Agents 面板数据源。provider 级返回空(与 Claude 一致,
	// 无 host 配置的静态目录);会话级从 fork 运行时 API(GET /skill /command /agent)拉取。
	getCustomizations(): readonly Customization[] { return []; }

	// test-workbench_change - 新上游改名 getSessionCustomizations→getChatCustomizations(chat 寻址)
	async getChatCustomizations(chat: URI, _context: AgentChatOperationContext, _hostCustomizations?: readonly Customization[]): Promise<readonly Customization[]> {
		const sess = this._resolveSession(chat);
		return sess ? sess.getCustomizations() : [];
	}
	// test-workbench_change end

	// test-workbench_change start — opencode 合成 customization URI(opencode-customization:
	// scheme,清单来自运行时 API,无磁盘源文件)。UI 点开 agent/command 详情时,AgentService
	// 的 resourceRead 会落到文件服务并抛 ENOPRO 500;此处返回合成的只读 markdown 详情视图。
	async describeCustomization(uri: URI): Promise<string | undefined> {
		if (uri.scheme !== 'opencode-customization') { return undefined; }
		let entries: readonly Customization[];
		try {
			const ready = await this._ensureConnection();
			entries = await fetchOpenCodeCustomizations(ready.baseUrl, ready.authHeader, undefined, this._logService);
		} catch (err) {
			this._logService.warn(`[TestAgent] describeCustomization failed for ${uri.toString()}: ${err}`);
			return undefined;
		}
		const target = uri.toString(true);
		const header = '# opencode 运行时清单条目(只读,无源文件)';
		for (const entry of entries) {
			const container = entry as DirectoryCustomization;
			const children = (container.children ?? []) as Array<{ uri: string; name?: string; description?: string; model?: string }>;
			if (container.uri === target) {
				const lines: string[] = [`# ${container.name ?? 'customizations'}`, '', header];
				for (const child of children) {
					lines.push('', `## ${child.name ?? child.uri}`);
					if (child.description) { lines.push('', child.description); }
					if (child.model) { lines.push('', `model: \`${child.model}\``); }
				}
				return lines.join('\n');
			}
			const child = children.find(c => c.uri === target);
			if (child) {
				const lines: string[] = [`# ${child.name ?? child.uri}`, ''];
				if (child.description) { lines.push(child.description, ''); }
				if (child.model) { lines.push(`- model: \`${child.model}\``, ''); }
				lines.push(`- type: ${container.name ?? ''}`, `- source: ${'opencode 运行时清单(GET /' + (container.name ?? '') + ',只读,无源文件)'}`);
				return lines.join('\n');
			}
		}
		return undefined;
	}
	// test-workbench_change end

	// test-workbench_change start — 清单源目录变更 → 会话缓存失效 + 防抖广播 agent 级事件。
	// 触发源:① fs.watch 到 agent/command/skill 目录文件变化(覆盖手动新建/编辑/删除/外部 CLI);
	// ② deleteCustomization;③ turn 结束(creator agent 可能刚写入新文件)。
	private _notifyCustomizationsChanged(): void {
		for (const [, s] of this._sessions) { s.invalidateCustomizationsCache(); }
		if (this._customizationsDebounce === undefined) {
			this._customizationsDebounce = setTimeout(() => {
				this._customizationsDebounce = undefined;
				this._onDidCustomizationsChange.fire();
			}, 1000);
		}
	}

	/** 监听用户级 + 项目级 customization 源目录(不存在的目录静默跳过;canonical 三目录由
	 *  openCodeCustomizations.userConfigSubDir 在拉清单时 ensure)。 */
	private _watchCustomizationRoots(workingDirectory: URI | undefined): void {
		const dirs: string[] = [];
		const subs = ['agent', 'agents', 'command', 'commands', 'skill', 'skills'];
		const userRoot = userTestagentConfigRoot();
		for (const sub of subs) { dirs.push(join(userRoot, sub)); }
		if (workingDirectory) {
			for (const base of [join(workingDirectory.fsPath, '.testagent'), join(workingDirectory.fsPath, '.opencode')]) {
				for (const sub of subs) { dirs.push(join(base, sub)); }
			}
		}
		for (const dir of dirs) {
			if (this._customizationWatchers.has(dir)) { continue; }
			try {
				const watcher = fs.watch(dir, { persistent: false }, () => this._notifyCustomizationsChanged());
				watcher.on('error', () => { this._customizationWatchers.delete(dir); try { watcher.close(); } catch { /* ignore */ } });
				this._customizationWatchers.set(dir, watcher);
			} catch { /* 目录不存在:跳过 */ }
		}
		// test-workbench_change start — Instructions(Rule):监听全局 config 根与项目根的
		// AGENTS.md 系列文件变化(filename 窄化,避免项目根其它文件的噪音),触发清单失效刷新。
		const ruleWatchTargets: Array<{ dir: string; filter: (f: string | null) => boolean }> = [
			{ dir: userRoot, filter: f => !!f && /^AGENTS\.md$/i.test(f) },
		];
		if (workingDirectory) {
			ruleWatchTargets.push({ dir: workingDirectory.fsPath, filter: f => !!f && /^(AGENTS|CLAUDE|CONTEXT)\.md$/i.test(f) });
		}
		for (const { dir, filter } of ruleWatchTargets) {
			const key = `rules:${dir}`;
			if (this._customizationWatchers.has(key)) { continue; }
			try {
				const watcher = fs.watch(dir, { persistent: false }, (_event, filename) => { if (filter(filename)) { this._notifyCustomizationsChanged(); } });
				watcher.on('error', () => { this._customizationWatchers.delete(key); try { watcher.close(); } catch { /* ignore */ } });
				this._customizationWatchers.set(key, watcher);
			} catch { /* 目录不存在:跳过 */ }
		}
		// test-workbench_change end
	}

	/** 会话构造点统一接线:turn 结束通知 + 项目级目录监听。 */
	private _bindSessionCustomizations(session: IOpenCodeSession, workingDirectory: URI | undefined): void {
		session.onTurnEnd = () => this._notifyCustomizationsChanged();
		this._watchCustomizationRoots(workingDirectory);
	}
	// test-workbench_change end

	// test-workbench_change start — 合成 customization URI 反向映射到真实源文件路径(agent/command
	// 的 md、skill 的目录)。搜索根:用户级 ~/.config/testagent + 各会话项目的 .testagent/.opencode;
	// 目录/文件名候选与后端加载约定一致(config.ts ConfigAgent/ConfigCommand.load、skill/index.ts)。
	resolveCustomizationSourcePaths(uri: URI): string[] {
		if (uri.scheme !== 'opencode-customization') { return []; }
		const seg = uri.path.split('/').filter(Boolean); // ['agents','workAgent']
		if (seg.length !== 2) { return []; }
		const kind = seg[0];
		const name = decodeURIComponent(seg[1]);
		const dirPairs = kind === 'agents' ? ['agent', 'agents'] : kind === 'commands' ? ['command', 'commands'] : kind === 'skills' ? ['skill', 'skills'] : [];
		if (!dirPairs.length) { return []; }
		const roots: string[] = [userTestagentConfigRoot()];
		for (const [, s] of this._sessions) {
			const wd = s.currentWorkingDirectory;
			if (wd) { roots.push(join(wd.fsPath, '.testagent'), join(wd.fsPath, '.opencode')); }
		}
		const fileNames = kind === 'agents' ? [`${name}.md`, `${name}.agent.md`] : [`${name}.md`];
		const found: string[] = [];
		for (const root of roots) {
			for (const dir of dirPairs) {
				if (kind === 'skills') {
					const skillDir = join(root, dir, name);
					if (fs.existsSync(join(skillDir, 'SKILL.md'))) { found.push(skillDir); }
				} else {
					for (const f of fileNames) {
						const p = join(root, dir, f);
						if (fs.existsSync(p)) { found.push(p); }
					}
				}
			}
		}
		return found;
	}

	// 删除合成 customization 条目:删掉全部映射到的源文件,随后失效所有会话的清单缓存让 UI
	// 立即刷新。内置 agent 与 config JSONC 声明的条目无源文件,抛出明确错误(不可删)。
	async deleteCustomization(uri: URI): Promise<void> {
		if (uri.scheme !== 'opencode-customization') {
			throw new Error(`Unsupported customization uri: ${uri.toString()}`);
		}
		const paths = this.resolveCustomizationSourcePaths(uri);
		if (!paths.length) {
			throw new Error(`no source file for ${uri.path} (built-in or config-declared customizations cannot be deleted)`);
		}
		for (const p of paths) { fs.rmSync(p, { recursive: true, force: true }); }
		this._notifyCustomizationsChanged();
		this._logService.info(`[TestAgent] deleted customization ${uri.path} from ${paths.length} source file(s)`);
	}
	// test-workbench_change end

	// ── Models ───────────────────────────────────────────────────────────────

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
				this._logService.info(`[TestAgent] loaded ${models.length} models from /provider`);
			} else {
				this._logService.warn('[TestAgent] /provider returned no models; keeping current model list');
			}
		} catch (err) {
			this._logService.warn(`[TestAgent] failed to refresh models: ${err}`);
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
			this._logService.warn(`[TestAgent] failed to persist session map: ${err}`);
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
				throw new Error(`TestAgent ${method} ${path} failed: HTTP ${resp.status}`);
			}
			return await resp.json() as T;
		} finally {
			clearTimeout(timer);
		}
	}
}

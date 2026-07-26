// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { IObservable, observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import {
	AgentProvider, AgentSession, AgentSignal,
	IActiveClient, IAgent, IAgentChats, IAgentCreateChatOptions,
	IAgentCreateChatResult, IAgentCreateSessionConfig,
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
} from '../../common/state/protocol/state.js';
import {
	type MessageAttachment,
	type ToolCallResult, type Turn,
	parseChatUri,
} from '../../common/state/sessionState.js';
import { ActiveClientToolSet } from '../activeClientState.js';
import { IOpenCodeSession, OpenCodeSession } from './openCodeSession.js';
import { OpenCodeEventStream } from './openCodeEventStream.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENCODE_STARTUP_TIMEOUT = 30_000;
const OPENCODE_REQUEST_TIMEOUT = 120_000;

const OPENCODE_MODELS: readonly IAgentModelInfo[] = [
	{ provider: OPENCODE_AGENT_PROVIDER_ID, id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', supportsVision: true },
	{ provider: OPENCODE_AGENT_PROVIDER_ID, id: 'claude-haiku-4', name: 'Claude Haiku 4', supportsVision: true },
	{ provider: OPENCODE_AGENT_PROVIDER_ID, id: 'gpt-4-5', name: 'GPT 4.5', supportsVision: true },
	{ provider: OPENCODE_AGENT_PROVIDER_ID, id: 'gemini-2-5-pro', name: 'Gemini 2.5 Pro', supportsVision: true },
	{ provider: OPENCODE_AGENT_PROVIDER_ID, id: 'opencode-default', name: 'OpenCode Default', supportsVision: true },
];

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

	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, OPENCODE_MODELS);
	readonly models: IObservable<readonly IAgentModelInfo[]> = this._models;

	private readonly _sessions = this._register(new DisposableMap<string, IOpenCodeSession>());
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
			displayName: 'OpenCode',
			description: 'OpenCode agent - a terminal-native AI coding assistant',
		};
	}

	// ── IAgentChats ────────────────────────────────────────────────────────

	readonly chats: IAgentChats = {
		createChat: (_chat: URI, _options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void> =>
			Promise.resolve(),
		fork: (_chat: URI, _source: any, _options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void> =>
			Promise.reject(new Error('Fork not supported by OpenCode agent')),
		disposeChat: (_chat: URI): Promise<void> =>
			Promise.resolve(),
		sendMessage: async (chat: URI, prompt: string, _workingDirectory: URI | undefined, _attachments?: readonly MessageAttachment[], turnId?: string, _senderClientId?: string): Promise<void> => {
			const session = this._resolveSession(chat);
			if (!session) {
				throw new Error(`OpenCode session not found for chat ${chat.toString()}`);
			}
			const toolNames = this._getEnabledToolNames(chat);
			await session.sendMessage(prompt, turnId, toolNames);
		},
		abort: async (chat: URI): Promise<void> => {
			const session = this._resolveSession(chat);
			if (session) { session.abort(); }
		},
		changeModel: async (_chat: URI, _model: ModelSelection): Promise<void> => { },
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

		const session = new OpenCodeSession(
			sessionId, sessionUri,
			ready.baseUrl, ready.authHeader,
			this._onDidSessionProgress,
			this._logService,
		);

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
		}
	}

	// ── Permissions ────────────────────────────────────────────────────────

	respondToPermissionRequest(_requestId: string, _approved: boolean): void {
		for (const [, s] of this._sessions) {
			s.respondToPermissionRequest(_requestId, _approved);
		}
	}

	respondToUserInputRequest(_requestId: string, _response: any, _answers?: Record<string, any>): void { }

	// ── Configuration ──────────────────────────────────────────────────────

	async resolveSessionConfig(_params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		return { schema: { type: 'object', properties: {} } as any, values: {} };
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
			set tools(val: readonly any[]) { toolSet!.set(client.clientId, val); },
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

			this._logService.info('[OpenCode] spawning opencode serve --port=0');

			const child = cp.spawn('opencode', args, {
				env,
				stdio: ['pipe', 'pipe', 'pipe'],
			});

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

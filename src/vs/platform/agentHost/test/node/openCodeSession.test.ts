/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import assert from 'assert';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { AgentSignal } from '../../common/agentService.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { IOpenCodePermissionRule, OpenCodeSession } from '../../node/openCode/openCodeSession.js';
import { buildSubagentChatUri } from '../../common/state/sessionState.js';

interface AnySession {
	opencodeSessionId: string;
	_currentTurnId: string;
	_currentPrompt?: string;
	handleEvent(event: { type: string; properties: Record<string, unknown> }): void;
	sendMessage(prompt: string): Promise<void>;
	fork(messageID?: string): Promise<string>;
	truncate(turnId: string | undefined): Promise<void>;
	setPermissionRules(ruleset: readonly IOpenCodePermissionRule[]): Promise<void>;
	getSubagentSession(chat: URI): { opencodeSessionId: string } | undefined;
	materializeSubagent(chat: URI, toolCallId: string): Promise<{ opencodeSessionId: string } | undefined>;
	respondToPermissionRequest(requestId: string, approved: boolean): void;
	respondToUserInputRequest(requestId: string, response: never, answers?: never): void;
}

interface CapturedAction {
	type: string;
	toolCallId?: string;
	confirmed?: string;
	result?: unknown;
	content?: string;
	part?: { content?: string };
}

interface CapturedSignal {
	kind: string;
	chat?: URI;
	toolCallId?: string;
	agentName?: string;
	taskDescription?: string;
}

function createSession(store: DisposableStore): { session: AnySession; actions: CapturedAction[]; signals: CapturedSignal[] } {
	const emitter = new Emitter<AgentSignal>();
	store.add(emitter);
	const actions: CapturedAction[] = [];
	const signals: CapturedSignal[] = [];
	store.add(emitter.event(s => {
		if (s.kind === 'action') {
			actions.push(s.action as unknown as CapturedAction);
		} else {
			signals.push(s as unknown as CapturedSignal);
		}
	}));
	const raw = new OpenCodeSession(
		'sid', URI.parse('agent://session/sid'), 'http://base', 'auth',
		emitter, new NullLogService(),
	);
	store.add(raw);
	const session = raw as unknown as AnySession;
	session.opencodeSessionId = 'oc-1';
	session._currentTurnId = 'turn-1';
	return { session, actions, signals };
}

interface FetchCall {
	url: string;
	method: string;
	body?: unknown;
}

/** stub 全局 fetch:记录调用,按 url/方法定制响应(store 注册还原) */
function stubFetch(store: DisposableStore, respond?: (call: FetchCall) => { status?: number; json?: unknown }): FetchCall[] {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	const impl = async (input: { url?: string } | string, init?: { method?: string; body?: string }) => {
		const url = typeof input === 'string' ? input : input.url ?? '';
		const call: FetchCall = { url, method: init?.method ?? 'GET' };
		if (init?.body) {
			try { call.body = JSON.parse(init.body); } catch { call.body = init.body; }
		}
		calls.push(call);
		const r = respond?.(call) ?? {};
		return new Response(r.json !== undefined ? JSON.stringify(r.json) : '', { status: r.status ?? 200 });
	};
	(globalThis as { fetch: unknown }).fetch = impl;
	store.add(toDisposable(() => { (globalThis as { fetch: unknown }).fetch = original; }));
	return calls;
}

suite('OpenCodeSession', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tool part updates drive Start → Ready → Complete state machine', () => {
		const store = new DisposableStore();
		try {
			const { session, actions } = createSession(store);
			const toolPart = (status: string, extra: Record<string, unknown> = {}) => ({
				id: 'p1', type: 'tool', callID: 'c1', tool: 'bash',
				state: { status, ...extra },
			});

			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: toolPart('pending') } });
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: toolPart('running', { input: { command: 'ls' } }) } });
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: toolPart('completed', { output: 'ok' }) } });

			// pending → Start + Ready(无 input);running 带 input → 补发 Ready 更新 toolInput;completed → Complete
			assert.deepStrictEqual(
				actions.map(a => a.type),
				[ActionType.ChatToolCallStart, ActionType.ChatToolCallReady, ActionType.ChatToolCallReady, ActionType.ChatToolCallComplete],
			);
			assert.strictEqual(actions[0].toolCallId, 'c1');
			assert.strictEqual(actions[1].confirmed, 'not-needed');
			assert.deepStrictEqual(actions[2].result, undefined);
			assert.strictEqual(actions[2].confirmed, 'not-needed');
			assert.strictEqual((actions[3].result as { success?: boolean }).success, true);
		} finally {
			store.dispose();
		}
	});

	test('tool call completes only once across repeated part updates', () => {
		const store = new DisposableStore();
		try {
			const { session, actions } = createSession(store);
			const part = (status: string) => ({ id: 'p1', type: 'tool', callID: 'c1', tool: 'bash', state: { status } });

			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: part('pending') } });
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: part('completed') } });
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: part('completed') } });

			assert.strictEqual(actions.filter(a => a.type === ActionType.ChatToolCallComplete).length, 1);
		} finally {
			store.dispose();
		}
	});

	test('text delta and full updated de-duplicate per part', () => {
		const store = new DisposableStore();
		try {
			const { session, actions } = createSession(store);

			session.handleEvent({ type: 'message.part.delta', properties: { sessionID: 'oc-1', partID: 'p1', field: 'text', delta: 'hello' } });
			session.handleEvent({ type: 'message.part.delta', properties: { sessionID: 'oc-1', partID: 'p1', field: 'text', delta: ' world' } });
			// 全量 updated 与累积一致 → 不产生重复增量
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: { id: 'p1', type: 'text', text: 'hello world' } } });

			// 首段以 ChatResponsePart 开新 part,其后为 ChatDelta 增量
			const pieces = actions
				.filter(a => a.type === ActionType.ChatDelta || a.type === ActionType.ChatResponsePart)
				.map(a => a.type === ActionType.ChatResponsePart ? a.part?.content : a.content);
			assert.deepStrictEqual(pieces, ['hello', ' world']);
		} finally {
			store.dispose();
		}
	});

	// fork 对用户消息的 part(prompt 原文)也发 message.part.updated/delta,
	// 用户消息的 message.updated 先于其 part 事件到达,必须按消息角色过滤,
	// 否则用户输入会被重复渲染进响应
	test('ignores parts that belong to non-assistant messages', () => {
		const store = new DisposableStore();
		try {
			const { session, actions } = createSession(store);
			session._currentPrompt = '分析当前项目';

			// 用户消息创建(先于其 part 事件)
			session.handleEvent({ type: 'message.updated', properties: { sessionID: 'oc-1', info: { id: 'm-user', role: 'user' } } });
			// 用户消息的 text part(prompt 原文)→ 忽略
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: { id: 'p-user', messageID: 'm-user', type: 'text', text: '分析当前项目' } } });
			// 用户消息的 delta → 忽略
			session.handleEvent({ type: 'message.part.delta', properties: { sessionID: 'oc-1', messageID: 'm-user', partID: 'p-user2', field: 'text', delta: 'x' } });
			// 缺 messageID 但文本与 prompt 全等 → 兜底忽略
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: { id: 'p-noid', type: 'text', text: '分析当前项目' } } });
			// assistant 消息创建 + text part → 正常渲染
			session.handleEvent({ type: 'message.updated', properties: { sessionID: 'oc-1', info: { id: 'm-ast', role: 'assistant' } } });
			session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: { id: 'p-ast', messageID: 'm-ast', type: 'text', text: 'ok' } } });

			const rendered = actions.filter(a => a.type === ActionType.ChatResponsePart).map(a => a.part?.content);
			assert.deepStrictEqual(rendered, ['ok']);
		} finally {
			store.dispose();
		}
	});

	// 每次 POST /session/:id/prompt_async 都携带文件链接契约(fork 的 system 字段,
	// 追加到 system prompt),强制模型输出 [name](/abs/path) 可点击链接
	test('message POST carries the file-link system prompt', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			// prompt_async 立即返回;turn 结束由轮询探测(assistant 消息带最终 finish,
			// created 取未来值以稳定通过轮询的 turn 起点过滤)
			const created = Date.now() + 60_000;
			const calls = stubFetch(store, call => call.method === 'GET'
				? { json: [{ info: { id: 'm-x', role: 'assistant', finish: 'stop', time: { created } } }] }
				: {});
			await session.sendMessage('hi');
			const post = calls.find(c => c.method === 'POST' && c.url.includes('/prompt_async'));
			assert.ok(post, 'POST /session/:id/prompt_async 应被调用');
			const body = post?.body as { system?: unknown };
			assert.ok(typeof body.system === 'string' && body.system.includes('file_folder_and_symbol_links'), 'system 应携带文件链接契约');
		} finally {
			store.dispose();
		}
	});

	// ── truncate / fork 锚点 / 权限 owner / 会话 ruleset ─────────────────────

	// host turn id 是 orchestrator mint 的 uuid;truncate/fork 必须先经
	// message.updated 登记的锚点翻译成 opencode 消息 id
	test('truncate deletes backend messages after the anchored turn', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			// 登记锚点:turn-1 → m-a2(本轮最后见到的消息)
			session.handleEvent({ type: 'message.updated', properties: { sessionID: 'oc-1', info: { id: 'm-a1', role: 'user' } } });
			session.handleEvent({ type: 'message.updated', properties: { sessionID: 'oc-1', info: { id: 'm-a2', role: 'assistant' } } });
			const calls = stubFetch(store, call => {
				if (call.method === 'GET') {
					return { json: [{ info: { id: 'm-a1', role: 'user' } }, { info: { id: 'm-a2', role: 'assistant' } }, { info: { id: 'm-b1', role: 'user' } }, { info: { id: 'm-b2', role: 'assistant' } }] };
				}
				return { json: true };
			});

			await session.truncate('turn-1');

			const deleted = calls.filter(c => c.method === 'DELETE').map(c => c.url.split('/').pop());
			assert.deepStrictEqual(deleted, ['m-b1', 'm-b2']);
		} finally {
			store.dispose();
		}
	});

	test('truncate with no turn id removes the whole transcript', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			const calls = stubFetch(store, call => call.method === 'GET'
				? { json: [{ info: { id: 'm-1', role: 'user' } }, { info: { id: 'm-2', role: 'assistant' } }] }
				: { json: true });

			await session.truncate(undefined);

			assert.deepStrictEqual(calls.filter(c => c.method === 'DELETE').map(c => c.url.split('/').pop()), ['m-1', 'm-2']);
		} finally {
			store.dispose();
		}
	});

	test('truncate skips silently when the anchor turn is unknown to the backend', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			const calls = stubFetch(store, call => call.method === 'GET'
				? { json: [{ info: { id: 'm-1', role: 'user' } }] }
				: { json: true });

			await session.truncate('turn-unknown');

			assert.strictEqual(calls.filter(c => c.method === 'DELETE').length, 0);
		} finally {
			store.dispose();
		}
	});

	// fork 的 "up to and including" 语义:后端复制边界是 exclusive,host turn id
	// 先翻译成锚点消息,再传锚点的【下一条】消息 id 作为 boundary
	test('fork translates the host turn id into the exclusive backend boundary', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			session.handleEvent({ type: 'message.updated', properties: { sessionID: 'oc-1', info: { id: 'm-a2', role: 'assistant' } } });
			const calls = stubFetch(store, call => call.method === 'GET'
				? { json: [{ info: { id: 'm-a1', role: 'user' } }, { info: { id: 'm-a2', role: 'assistant' } }, { info: { id: 'm-b1', role: 'user' } }] }
				: { json: { id: 'oc-forked' } });

			const newId = await session.fork('turn-1');

			assert.strictEqual(newId, 'oc-forked');
			const forkCall = calls.find(c => c.url.includes('/fork'));
			assert.ok(forkCall, 'POST /session/:id/fork 应被调用');
			assert.deepStrictEqual(forkCall.body, { messageID: 'm-b1' });
		} finally {
			store.dispose();
		}
	});

	test('fork at the last anchored message omits the boundary (whole session)', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			session.handleEvent({ type: 'message.updated', properties: { sessionID: 'oc-1', info: { id: 'm-last', role: 'assistant' } } });
			const calls = stubFetch(store, call => call.method === 'GET'
				? { json: [{ info: { id: 'm-1', role: 'user' } }, { info: { id: 'm-last', role: 'assistant' } }] }
				: { json: { id: 'oc-forked' } });

			await session.fork('turn-1');

			const forkCall = calls.find(c => c.url.includes('/fork'));
			assert.deepStrictEqual(forkCall?.body, {}, '锚点为末条时不应传 boundary');
		} finally {
			store.dispose();
		}
	});

	// subagent spawn 通道:task part 的 state.metadata.sessionId 落地时登记只读
	// backing 并发 subagent_started signal,host 的 spawn channel 据此建目录
	test('task part with child session id emits subagent_started and registers the backing', () => {
		const store = new DisposableStore();
		try {
			const { session, signals } = createSession(store);
			session.handleEvent({
				type: 'message.part.updated',
				properties: {
					sessionID: 'oc-1',
					part: {
						id: 'p-task', type: 'tool', callID: 'call-1', tool: 'task',
						state: {
							status: 'running',
							input: { description: 'Inspect routes', prompt: 'look at server/routes', subagent_type: 'explore' },
							metadata: { sessionId: 'oc-child' },
						},
					},
				},
			});

			const started = signals.filter(s => s.kind === 'subagent_started');
			assert.strictEqual(started.length, 1, 'spawn 事件恰好发一次');
			assert.strictEqual(started[0].toolCallId, 'call-1');
			assert.strictEqual(started[0].agentName, 'explore');
			assert.strictEqual(started[0].taskDescription, 'Inspect routes');

			const subChat = URI.parse(buildSubagentChatUri(URI.parse('agent://session/sid'), 'call-1'));
			assert.strictEqual(session.getSubagentSession(subChat)?.opencodeSessionId, 'oc-child');
		} finally {
			store.dispose();
		}
	});

	// 冷恢复:parent transcript 中按 task callID 找回子会话 id 并重挂 backing
	test('materializeSubagent recovers the child session from the parent transcript', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			const records = [{
				info: { id: 'm-ast', role: 'assistant' },
				parts: [{ id: 'p1', type: 'tool', callID: 'call-9', tool: 'task', state: { status: 'completed', metadata: { sessionId: 'oc-child-9' } } }],
			}];
			stubFetch(store, call => call.method === 'GET' ? { json: records } : { json: true });

			const subChat = URI.parse(buildSubagentChatUri(URI.parse('agent://session/sid'), 'call-9'));
			const child = await session.materializeSubagent(subChat, 'call-9');

			assert.strictEqual(child?.opencodeSessionId, 'oc-child-9');
			assert.strictEqual(session.getSubagentSession(subChat)?.opencodeSessionId, 'oc-child-9');
		} finally {
			store.dispose();
		}
	});

	// agent 级 respond 是广播:只有收到 asked 事件的 owner session 真正回包
	test('permission reply is emitted only by the owning session', async () => {
		const store = new DisposableStore();
		try {
			const { session: owner } = createSession(store);
			const { session: other } = createSession(store);
			owner.handleEvent({
				type: 'permission.asked',
				properties: { id: 'per-1', sessionID: 'oc-1', permission: 'bash', patterns: ['ls'], tool: { messageID: 'm-1', callID: 'c-1' } },
			});
			const calls = stubFetch(store, () => ({ json: true }));

			other.respondToPermissionRequest('per-1', true);
			assert.strictEqual(calls.filter(c => c.url.includes('/permission/')).length, 0, '非 owner session 不得回包');

			owner.respondToPermissionRequest('per-1', true);
			const reply = calls.find(c => c.url.includes('/permission/per-1/reply'));
			assert.ok(reply, 'owner session 应回 POST /permission/:id/reply');
			assert.deepStrictEqual(reply.body, { reply: 'once' });
		} finally {
			store.dispose();
		}
	});

	test('setPermissionRules PATCHes the session permission ruleset', async () => {
		const store = new DisposableStore();
		try {
			const { session } = createSession(store);
			const calls = stubFetch(store, () => ({ json: { id: 'oc-1' } }));
			const ruleset: IOpenCodePermissionRule[] = [{ permission: '*', pattern: '*', action: 'allow' }];

			await session.setPermissionRules(ruleset);

			const patch = calls.find(c => c.method === 'PATCH' && c.url.endsWith('/session/oc-1'));
			assert.ok(patch, 'PATCH /session/:id 应被调用');
			assert.deepStrictEqual(patch.body, { permission: ruleset });
		} finally {
			store.dispose();
		}
	});
});

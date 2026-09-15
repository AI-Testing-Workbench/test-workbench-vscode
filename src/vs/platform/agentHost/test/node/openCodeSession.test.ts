/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import assert from 'assert';
import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { AgentSignal } from '../../common/agentService.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { OpenCodeSession } from '../../node/openCode/openCodeSession.js';

interface AnySession {
	opencodeSessionId: string;
	_currentTurnId: string;
	_currentPrompt?: string;
	handleEvent(event: { type: string; properties: Record<string, unknown> }): void;
	sendMessage(prompt: string): Promise<void>;
}

interface CapturedAction {
	type: string;
	toolCallId?: string;
	confirmed?: string;
	result?: unknown;
	content?: string;
	part?: { content?: string };
}

function createSession(): { session: AnySession; actions: CapturedAction[] } {
	const emitter = new Emitter<AgentSignal>();
	const actions: CapturedAction[] = [];
	emitter.event(s => {
		if (s.kind === 'action') {
			actions.push(s.action as unknown as CapturedAction);
		}
	});
	const raw = new OpenCodeSession(
		'sid', URI.parse('agent://session/sid'), 'http://base', 'auth',
		emitter, new NullLogService(),
	);
	const session = raw as unknown as AnySession;
	session.opencodeSessionId = 'oc-1';
	session._currentTurnId = 'turn-1';
	return { session, actions };
}

suite('OpenCodeSession', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tool part updates drive Start → Ready → Complete state machine', () => {
		const { session, actions } = createSession();
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
	});

	test('tool call completes only once across repeated part updates', () => {
		const { session, actions } = createSession();
		const part = (status: string) => ({ id: 'p1', type: 'tool', callID: 'c1', tool: 'bash', state: { status } });

		session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: part('pending') } });
		session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: part('completed') } });
		session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: part('completed') } });

		assert.strictEqual(actions.filter(a => a.type === ActionType.ChatToolCallComplete).length, 1);
	});

	test('text delta and full updated de-duplicate per part', () => {
		const { session, actions } = createSession();

		session.handleEvent({ type: 'message.part.delta', properties: { sessionID: 'oc-1', partID: 'p1', field: 'text', delta: 'hello' } });
		session.handleEvent({ type: 'message.part.delta', properties: { sessionID: 'oc-1', partID: 'p1', field: 'text', delta: ' world' } });
		// 全量 updated 与累积一致 → 不产生重复增量
		session.handleEvent({ type: 'message.part.updated', properties: { sessionID: 'oc-1', part: { id: 'p1', type: 'text', text: 'hello world' } } });

		const deltas = actions.filter(a => a.type === ActionType.ChatDelta).map(a => a.content);
		assert.deepStrictEqual(deltas, ['hello', ' world']);
	});

	// fork 对用户消息的 part(prompt 原文)也发 message.part.updated/delta,
	// 用户消息的 message.updated 先于其 part 事件到达,必须按消息角色过滤,
	// 否则用户输入会被重复渲染进响应
	test('ignores parts that belong to non-assistant messages', () => {
		const { session, actions } = createSession();
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
	});

	// 每次 POST /session/:id/prompt_async 都携带文件链接契约(fork 的 system 字段,
	// 追加到 system prompt),强制模型输出 [name](/abs/path) 可点击链接
	test('message POST carries the file-link system prompt', async () => {
		const { session } = createSession();
		let capturedBody: Record<string, unknown> | undefined;
		const originalFetch = globalThis.fetch;
		(globalThis as { fetch: unknown }).fetch = (async (input: { url?: string } | string, init?: { method?: string; body?: string }) => {
			const url = typeof input === 'string' ? input : input.url ?? '';
			if (init?.method === 'POST' && url.includes('/prompt_async')) {
				capturedBody = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
				return new Response('', { status: 200 });
			}
			return new Response('[]', { status: 200 });
		}) as unknown as typeof fetch;
		try {
			await session.sendMessage('hi');
		} finally {
			(globalThis as { fetch: unknown }).fetch = originalFetch;
		}
		assert.ok(capturedBody, 'POST /session/:id/prompt_async 应被调用');
		assert.ok(typeof capturedBody?.system === 'string' && capturedBody.system.includes('file_folder_and_symbol_links'), 'system 应携带文件链接契约');
	});
});

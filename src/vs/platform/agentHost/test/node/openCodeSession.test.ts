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
	handleEvent(event: { type: string; properties: Record<string, unknown> }): void;
}

function createSession(): { session: AnySession; actions: Array<{ type: string; toolCallId?: string; confirmed?: string; result?: unknown; content?: string }> } {
	const emitter = new Emitter<AgentSignal>();
	const actions: Array<{ type: string; toolCallId?: string; confirmed?: string; result?: unknown; content?: string }> = [];
	emitter.event(s => {
		if (s.kind === 'action') {
			actions.push({ type: s.action.type } as never);
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
});

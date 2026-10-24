/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { dshAgentContentSecurityPolicy, forwardDshAgentRequest, IDshAgentProxyTarget, WITHHELD_RESPONSE_HEADERS } from '../../node/dshAgentProxy.js';

const TARGET: IDshAgentProxyTarget = { origin: 'http://127.0.0.1:43210', cookie: 'dsh-auth=secret' };

interface FakeFetch {
	(input: string | URL | Request, init?: RequestInit): Promise<Response>;
	lastUrl: string;
	lastInit: RequestInit | undefined;
}

function fakeFetch(status: number, headers: Record<string, string>, body = 'ok'): FakeFetch {
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		fetchImpl.lastUrl = String(input);
		fetchImpl.lastInit = init;
		return new Response(body, { status, headers });
	}) as FakeFetch;
	fetchImpl.lastUrl = '';
	fetchImpl.lastInit = undefined;
	return fetchImpl;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
	return Object.fromEntries(new Headers(init?.headers).entries());
}

suite('dsh Agent HTTP proxy', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('forwards to the Host with the cookie and without the renderer origin', async () => {
		const fetchImpl = fakeFetch(200, { 'content-type': 'application/json' });
		const request = new Request('dsh-agent://app/api/session?limit=10', {
			headers: { cookie: 'evil=1', origin: 'dsh-agent://app', host: 'dsh-agent', 'x-test': 'kept' }
		});
		const response = await forwardDshAgentRequest(request, TARGET, fetchImpl);
		assert.strictEqual(response.status, 200);
		assert.strictEqual(fetchImpl.lastUrl, 'http://127.0.0.1:43210/api/session?limit=10');
		const headers = headersOf(fetchImpl.lastInit);
		assert.strictEqual(headers.cookie, 'dsh-auth=secret');
		assert.strictEqual(headers.origin, undefined);
		assert.strictEqual(headers.host, undefined);
		assert.strictEqual(headers['x-test'], 'kept');
	});

	test('withholds connection and authentication response headers', async () => {
		const fetchImpl = fakeFetch(200, {
			'content-type': 'text/plain',
			'content-length': '2',
			'set-cookie': 'dsh-auth=secret',
			'connection': 'keep-alive',
			'transfer-encoding': 'chunked'
		});
		const response = await forwardDshAgentRequest(new Request('dsh-agent://app/x'), TARGET, fetchImpl);
		for (const name of WITHHELD_RESPONSE_HEADERS) {
			assert.strictEqual(response.headers.get(name), null, name);
		}
	});

	test('adds a strict policy to the application document', async () => {
		const fetchImpl = fakeFetch(200, { 'content-type': 'text/html; charset=utf-8' });
		const response = await forwardDshAgentRequest(new Request('dsh-agent://app/'), TARGET, fetchImpl);
		const csp = response.headers.get('content-security-policy') ?? '';
		assert.ok(csp.includes(`default-src 'self'`));
		assert.ok(csp.includes('connect-src'));
		assert.ok(csp.includes('http://127.0.0.1:43210'));
		assert.ok(csp.includes('ws://127.0.0.1:43210'));
		assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
		assert.strictEqual(response.headers.get('x-frame-options'), 'DENY');
		assert.strictEqual(dshAgentContentSecurityPolicy(TARGET.origin).includes(`object-src 'none'`), true);
	});

	test('marks plugin bundles as uncached', async () => {
		const fetchImpl = fakeFetch(200, { 'content-type': 'text/javascript', 'cache-control': 'public, immutable' });
		const response = await forwardDshAgentRequest(new Request('dsh-agent://app/plugins/??a/client.js'), TARGET, fetchImpl);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
	});

	test('rejects traversal before reaching the Host', async () => {
		const fetchImpl = fakeFetch(200, { 'content-type': 'text/plain' });
		// The Request constructor normalizes `%2e%2e/`, so hand the proxy a raw
		// request whose encoded slash survives URL parsing.
		const raw = {
			url: 'dsh-agent://app/%2e%2e%2fetc/passwd',
			method: 'GET',
			headers: new Headers(),
			signal: new AbortController().signal,
			body: null
		} as unknown as Request;
		const response = await forwardDshAgentRequest(raw, TARGET, fetchImpl);
		assert.strictEqual(response.status, 400);
		assert.strictEqual(fetchImpl.lastInit, undefined);
	});

	test('rejects foreign authorities and unsupported methods', async () => {
		const fetchImpl = fakeFetch(200, { 'content-type': 'text/plain' });
		assert.strictEqual((await forwardDshAgentRequest(new Request('dsh-agent://other/x'), TARGET, fetchImpl)).status, 404);
		assert.strictEqual((await forwardDshAgentRequest(new Request('dsh-agent://app/x', { method: 'OPTIONS' }), TARGET, fetchImpl)).status, 405);
	});

	test('surfaces Host failures as rejected promises for the protocol error page', async () => {
		const fetchImpl = (async () => { throw new Error('connection refused'); }) as typeof fetch;
		await assert.rejects(() => forwardDshAgentRequest(new Request('dsh-agent://app/'), TARGET, fetchImpl), /connection refused/);
	});
});

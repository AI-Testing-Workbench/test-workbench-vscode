/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
//
// End-to-end smoke test for the dsh Agent Host integration without Electron:
// start a real `dsh web`, authenticate, proxy the application document through
// the same code the protocol handler uses, and fetch a plugin bundle.
//
// Usage: node scripts/dsh-agent/e2e-smoke.mjs [--keep]

import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keep = process.argv.includes('--keep');

// CI compiles to out-build; local `npm run compile` writes out. Prefer whichever
// contains the Agent modules so the smoke runs in both environments.
const compiledRoots = ['out', 'out-build'];
const compiledRoot = compiledRoots.find(candidate => existsSync(join(root, candidate, 'vs', 'platform', 'dshAgent', 'node', 'dshAgentHost.js')));
if (!compiledRoot) {
	throw new Error(`Missing compiled dsh Agent modules. Run "npm run compile" or "npm run gulp core-ci" first (looked in ${compiledRoots.join(', ')}).`);
}
const { DshAgentHostProcess } = await import(`../../${compiledRoot}/vs/platform/dshAgent/node/dshAgentHost.js`);
const { prepareDshAgentProfile } = await import(`../../${compiledRoot}/vs/platform/dshAgent/node/dshAgentProfile.js`);
const { createProxyTarget, forwardDshAgentRequest } = await import(`../../${compiledRoot}/vs/platform/dshAgent/node/dshAgentProxy.js`);
const { NullLogService } = await import(`../../${compiledRoot}/vs/platform/log/common/log.js`);

function findExecutable(name) {
	for (const directory of (process.env.PATH ?? '').split(delimiter)) {
		if (!directory) {
			continue;
		}
		const candidate = join(directory, name);
		try {
			return realpathSync(candidate);
		} catch {
			// continue
		}
	}
	throw new Error(`${name} was not found on PATH`);
}

async function findDshEntry() {
	const dsh = findExecutable('dsh');
	const real = await realpath(dsh);
	if (real.endsWith(join('lib', 'bin.js'))) {
		return real;
	}
	const prefixEntry = join(dirname(dirname(real)), 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
	if (await exists(prefixEntry)) {
		return prefixEntry;
	}
	throw new Error(`Could not resolve @deepseek-ai/dsh from ${real}; pass it with TSCODE_DSH_AGENT_DSH_ENTRY`);
}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

const home = await mkdtemp(join(tmpdir(), 'tscode-dsh-smoke-'));
const dshEntry = process.env.TSCODE_DSH_AGENT_DSH_ENTRY ?? await findDshEntry();
const prepared = await prepareDshAgentProfile({
	runtimeRoot: join(root, 'resources', 'dsh-agent'),
	node: process.execPath,
	dshEntry,
	dshCommand: undefined,
	dshHome: home,
	logDirectory: join(home, 'logs'),
	profile: 'web',
	webDist: undefined,
	runtimeVersion: 'smoke'
}, new NullLogService());
assert.equal(prepared.pluginInstalled, true, 'client plugin must be provisioned');
const stderr = [];
const hostNode = process.env.TSCODE_DSH_AGENT_SMOKE_NODE ?? process.execPath;
const host = new DshAgentHostProcess({
	command: hostNode,
	args: [dshEntry, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'],
	cwd: home,
	env: { ...process.env, DSH_HOME: home, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` },
	readyTimeoutMs: 180_000,
	onLog: (level, message) => {
		if (level === 'error') {
			stderr.push(message);
			console.error('[host]', message);
		}
	}
});

let ready;
try {
	console.log(`[smoke] dsh entry: ${dshEntry}`);
	console.log(`[smoke] DSH_HOME: ${home}`);
	const started = Date.now();
	ready = await host.start();
	console.log(`[smoke] host ready in ${Date.now() - started}ms at ${ready.origin}`);
	assert.ok(ready.cookie.length > 0);
	const target = createProxyTarget(ready.origin, ready.cookie);

	const index = await forwardDshAgentRequest(new Request('dsh-agent://app/'), target);
	assert.equal(index.status, 200);
	const html = await index.text();
	assert.ok(html.includes('__DSH_BOOT__'), 'index must include the dsh boot graph');
	const csp = index.headers.get('content-security-policy') ?? '';
	assert.ok(csp.includes('connect-src'), 'CSP should be present');
	assert.ok(csp.includes(ready.origin), 'CSP should allow the Host origin');
	console.log(`[smoke] application document: ${html.length} bytes, boot graph present`);

	const pluginPath = /src="(plugins\/\?\?[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
	assert.ok(pluginPath, 'index must reference a plugin bundle');
	assert.ok(html.includes('dsh-client-tscode/client.js'), 'the tscode client plugin must be loaded');
	assert.ok(!stderr.some(line => line.includes('did not activate')), 'managed profile must not skip rows');
	const plugin = await forwardDshAgentRequest(new Request(`dsh-agent://app/${pluginPath}`), target);
	assert.equal(plugin.status, 200);
	assert.equal(plugin.headers.get('cache-control'), 'no-store');
	const pluginBody = await plugin.text();
	assert.ok(pluginBody.includes('__ModuleLoader__.load'), 'plugin bundle must be module-loader code');
	console.log(`[smoke] plugin bundle: ${pluginBody.length} bytes, no-store`);

	// The window's webRequest fence rewrites Origin to the Host origin and injects
	// this cookie; verify the Host accepts exactly that handshake.
	const { default: WebSocket } = await import('ws');
	await new Promise((resolve, reject) => {
		const socket = new WebSocket(ready.origin.replace(/^http/, 'ws') + '/api/remote.mux', {
			headers: { origin: ready.origin, cookie: ready.cookie }
		});
		const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket handshake timed out')); }, 5000);
		socket.once('open', () => { clearTimeout(timer); socket.close(); resolve(); });
		socket.once('error', error => { clearTimeout(timer); reject(error); });
	});
	console.log('[smoke] WebSocket mux handshake accepted');

	// Creating a session resolves and mounts the default agent preset. This catches
	// profile patches that disable a service the shipped preset depends on (for
	// example `pluginManager`), which otherwise only fails in the UI.
	const sessionResponse = await forwardDshAgentRequest(new Request('dsh-agent://app/api/session/create', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			type: 'client-request',
			rpcId: 'smoke-session-create',
			method: 'session/create',
			payload: { args: { request: { cwd: home } } }
		})
	}), target);
	assert.equal(sessionResponse.status, 200);
	const sessionResult = await sessionResponse.json();
	assert.equal(sessionResult.result?.ok, true, `session create failed: ${JSON.stringify(sessionResult)}`);
	assert.ok(sessionResult.result.value?.sessionId, 'session create must return a session id');
	assert.equal(sessionResult.result.value?.agentPreset, 'standard');
	console.log(`[smoke] agent session created with preset ${sessionResult.result.value.agentPreset}`);

	const traversal = await forwardDshAgentRequest({
		url: 'dsh-agent://app/%2e%2e%2fetc/passwd',
		method: 'GET',
		headers: new Headers(),
		signal: new AbortController().signal,
		body: null
	}, target);
	assert.equal(traversal.status, 400);
	console.log('[smoke] traversal rejected with 400');

	const readyFile = join(home, 'profiles', 'web', 'package.json');
	const manifest = await readFile(readyFile, 'utf8');
	assert.ok(manifest.includes('dsh-web-app'));
	assert.ok(manifest.includes('dsh-client-tscode'));
	console.log('[smoke] isolated dsh profile initialized with the client plugin');
	console.log('[smoke] PASS');
} finally {
	await host.stop().catch(error => console.error('[smoke] stop failed', error));
	if (!keep) {
		await rm(home, { recursive: true, force: true });
	} else {
		console.log(`[smoke] kept ${home}`);
	}
}

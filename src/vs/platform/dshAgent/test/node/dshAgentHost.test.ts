/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { DshAgentHostProcess, DshAgentHostStartError } from '../../node/dshAgentHost.js';

const HOST_SCRIPT = `
import { createServer } from 'node:http';
const server = createServer((request, response) => {
	if (request.url.startsWith('/?token=')) {
		response.writeHead(303, { location: './', 'set-cookie': 'dsh-auth=test; Path=/; HttpOnly' });
		response.end();
		return;
	}
	response.writeHead(200, { 'content-type': 'text/plain' });
	response.end('ok');
});
server.listen(0, '127.0.0.1', () => {
	const port = server.address().port;
	console.log('dsh web: http://127.0.0.1:' + port + '/?token=secret-token');
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
`;

const FAILING_SCRIPT = `
console.error('plugin failed to load: /tmp/private/config.yml');
process.exit(3);
`;

suite('dsh Agent Host process', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('starts, authenticates, and stops without leaving a child', async function () {
		this.timeout(15000);
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-host-'));
		const script = join(directory, 'host.mjs');
		await writeFile(script, HOST_SCRIPT);
		const logs: string[] = [];
		const host = new DshAgentHostProcess({
			command: process.execPath,
			args: [script],
			cwd: directory,
			env: { ...process.env, TEST_MARKER: '1' },
			onLog: (level, message) => logs.push(`${level}:${message}`)
		});
		try {
			const ready = await host.start();
			assert.ok(ready.url.includes('token=secret-token'));
			assert.match(ready.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
			assert.strictEqual(ready.cookie, 'dsh-auth=test');
			assert.ok(logs.some(line => line.includes('[redacted]')));
			assert.ok(!logs.some(line => line.includes('secret-token')));
			await host.stop();
			await host.exited;
		} finally {
			await host.stop().catch(() => undefined);
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('reports a startup failure with a redacted stderr tail', async function () {
		this.timeout(15000);
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-host-fail-'));
		const script = join(directory, 'host.mjs');
		await writeFile(script, FAILING_SCRIPT);
		const host = new DshAgentHostProcess({
			command: process.execPath,
			args: [script],
			cwd: directory,
			env: { ...process.env }
		});
		try {
			await assert.rejects(() => host.start(), (error: unknown) => {
				assert.ok(error instanceof DshAgentHostStartError);
				assert.ok(!error.stderrTail.includes('secret'), 'stderr must be redacted');
				return true;
			});
		} finally {
			await host.stop().catch(() => undefined);
			await rm(directory, { recursive: true, force: true });
		}
	});
});

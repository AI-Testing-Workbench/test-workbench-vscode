/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import assert from 'assert';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { isWindows } from '../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DEFAULT_DSH_AGENT_WINDOW_SETTINGS } from '../../common/dshAgentPaths.js';
import { createDshAgentHostEnvironment, resolveDshAgentPaths } from '../../node/dshAgentPaths.js';

suite('dsh Agent paths', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves the packaged runtime under appRoot/resources/dsh-agent', async () => {
		const root = await mkdtemp(join(tmpdir(), 'dsh-agent-paths-'));
		const savedNode = process.env['TSCODE_DSH_AGENT_NODE'];
		const savedEntry = process.env['TSCODE_DSH_AGENT_DSH_ENTRY'];
		delete process.env['TSCODE_DSH_AGENT_NODE'];
		delete process.env['TSCODE_DSH_AGENT_DSH_ENTRY'];
		try {
			const runtime = join(root, 'resources', 'dsh-agent');
			const node = isWindows ? join(runtime, 'node', 'node.exe') : join(runtime, 'node', 'bin', 'node');
			const entry = join(runtime, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
			await mkdir(join(runtime, 'node', isWindows ? '' : 'bin'), { recursive: true });
			await mkdir(join(runtime, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
			await mkdir(join(runtime, 'web'), { recursive: true });
			await writeFile(node, 'node');
			await writeFile(entry, 'entry');
			await writeFile(join(runtime, 'web', 'index.html'), '<html>');
			await writeFile(join(runtime, 'VERSION'), 'dsh 0.2.0-rc.2 / node v22.22.1 / format 1\n');
			const paths = resolveDshAgentPaths(root, join(root, 'user-data'), DEFAULT_DSH_AGENT_WINDOW_SETTINGS);
			assert.strictEqual(paths.runtimeRoot, runtime);
			assert.strictEqual(paths.node, node);
			assert.strictEqual(paths.dshEntry, entry);
			assert.strictEqual(paths.dshCommand, undefined);
			assert.strictEqual(paths.webDist, join(runtime, 'web'));
			assert.ok(paths.runtimeVersion?.includes('0.2.0-rc.2'));
			assert.strictEqual(paths.logDirectory, join(root, 'user-data', 'logs', 'dsh-agent'));
		} finally {
			if (savedNode === undefined) { delete process.env['TSCODE_DSH_AGENT_NODE']; } else { process.env['TSCODE_DSH_AGENT_NODE'] = savedNode; }
			if (savedEntry === undefined) { delete process.env['TSCODE_DSH_AGENT_DSH_ENTRY']; } else { process.env['TSCODE_DSH_AGENT_DSH_ENTRY'] = savedEntry; }
			await rm(root, { recursive: true, force: true });
		}
	});

	test('passes a bounded environment to the Host', () => {
		const paths = {
			runtimeRoot: '/r',
			node: isWindows ? 'C:\\node\\node.exe' : '/node/bin/node',
			dshEntry: '/r/dsh.js',
			dshCommand: undefined,
			dshHome: '/home/.tscode-dsh',
			logDirectory: '/logs',
			profile: 'web',
			webDist: undefined,
			runtimeVersion: '1'
		};
		const environment = createDshAgentHostEnvironment(paths, { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', SECRET: 'kept' });
		assert.strictEqual(environment['DSH_HOME'], '/home/.tscode-dsh');
		assert.strictEqual(environment['ELECTRON_RUN_AS_NODE'], undefined);
		assert.strictEqual(environment['SECRET'], 'kept');
		assert.ok(environment['PATH']?.startsWith(isWindows ? 'C:\\node' : '/node/bin'));
	});
});

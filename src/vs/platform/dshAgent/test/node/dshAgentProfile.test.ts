/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { NullLogService } from '../../../log/common/log.js';
import { IDshAgentPaths } from '../../common/dshAgentPaths.js';
import { DSH_AGENT_DISABLED_PLUGINS, prepareDshAgentProfile, removeDshAgentProfileFiles } from '../../node/dshAgentProfile.js';

function pathsFor(root: string): IDshAgentPaths {
	return {
		runtimeRoot: join(root, 'runtime'),
		node: join(root, 'node'),
		dshEntry: join(root, 'dsh.js'),
		dshCommand: undefined,
		dshHome: join(root, 'home'),
		logDirectory: join(root, 'logs'),
		profile: 'web',
		webDist: undefined,
		runtimeVersion: '0.2.0-rc.2'
	};
}

suite('dsh Agent profile', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('creates an isolated home with the managed allowlist', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			const prepared = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(prepared.changed, true);
			assert.strictEqual(prepared.info.profile, 'web');
			assert.strictEqual(prepared.info.runtimeVersion, '0.2.0-rc.2');
			const patch = await readFile(join(paths.dshHome, 'cordis.patch.yml'), 'utf8');
			for (const id of DSH_AGENT_DISABLED_PLUGINS) {
				assert.ok(patch.includes(`- id: ${id}`), id);
			}
			assert.ok(patch.includes('tscode dsh-agent managed'));
			const info = JSON.parse(await readFile(join(paths.dshHome, 'tscode-agent-profile.json'), 'utf8'));
			assert.strictEqual(info.format, 1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('provisions the client plugin bundle without pnpm', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			const plugin = join(paths.runtimeRoot, 'plugin', 'dsh-client-tscode');
			await mkdir(plugin, { recursive: true });
			await writeFile(join(plugin, 'package.json'), '{"name":"dsh-client-tscode","version":"0.1.0"}');
			const first = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(first.pluginInstalled, true);
			const manifest = JSON.parse(await readFile(join(paths.dshHome, 'profiles', 'web', 'package.json'), 'utf8'));
			assert.ok(manifest.dsh.profile.bundles.includes('dsh-client-tscode'));
			assert.ok(manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-base'));
			const link = join(paths.dshHome, 'profiles', 'web', 'node_modules', 'dsh-client-tscode');
			assert.ok(await stat(link));
			const second = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(second.pluginInstalled, true);
			assert.strictEqual(second.changed, false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('is idempotent and preserves user rows', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			await prepareDshAgentProfile(paths, new NullLogService());
			const patchPath = join(paths.dshHome, 'cordis.patch.yml');
			const withUserRow = `- id: user-plugin\n  disabled: true\n${await readFile(patchPath, 'utf8')}`;
			await writeFile(patchPath, withUserRow);

			const second = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(second.changed, false);
			const patch = await readFile(patchPath, 'utf8');
			assert.ok(patch.includes('- id: user-plugin'));
			assert.strictEqual(patch.split('tscode dsh-agent managed').length - 1, 2);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('replaces an empty user patch without producing invalid YAML', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			await prepareDshAgentProfile(paths, new NullLogService());
			const patchPath = join(paths.dshHome, 'cordis.patch.yml');
			await writeFile(patchPath, '[]\n');
			const prepared = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(prepared.changed, true);
			const patch = await readFile(patchPath, 'utf8');
			assert.ok(!patch.trim().startsWith('[]'));
			assert.ok(patch.includes('- id: plugin-manager'));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('removes only managed profile files', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(await removeDshAgentProfileFiles(paths), true);
			await assert.rejects(() => readFile(join(paths.dshHome, 'tscode-agent-profile.json')));
			assert.strictEqual(await removeDshAgentProfileFiles(paths), false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

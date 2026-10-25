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
import { DSH_AGENT_BUILTIN_PLUGINS, DSH_AGENT_DISABLED_PLUGINS, prepareDshAgentProfile, removeDshAgentProfileFiles } from '../../node/dshAgentProfile.js';

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

	test('creates an isolated home without a managed block', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			const prepared = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(prepared.changed, true);
			assert.strictEqual(prepared.info.profile, 'web');
			assert.strictEqual(prepared.info.runtimeVersion, '0.2.0-rc.2');
			// Nothing is disabled, so there is no patch file to parse at all.
			await assert.rejects(() => readFile(join(paths.dshHome, 'cordis.patch.yml')));
			const info = JSON.parse(await readFile(join(paths.dshHome, 'tscode-agent-profile.json'), 'utf8'));
			assert.strictEqual(info.format, 1);
			assert.deepStrictEqual(info.disabledPlugins, []);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('preserves dsh plugin management, hot reload, and agent presets', () => {
		// Plugin extensions are a product feature. The standard preset also mounts
		// `@deepseek-ai/dsh-plugin-manager/tools`; disabling its service makes
		// session creation fail with `agent-preset/invalid`.
		assert.deepStrictEqual(DSH_AGENT_DISABLED_PLUGINS, []);
	});

	test('provisions the built-in plugin bundles without pnpm', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			for (const name of DSH_AGENT_BUILTIN_PLUGINS) {
				const plugin = join(paths.runtimeRoot, 'plugin', name);
				await mkdir(plugin, { recursive: true });
				await writeFile(join(plugin, 'package.json'), JSON.stringify({ name, version: '0.1.0' }));
			}
			const first = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(first.pluginInstalled, true);
			const manifest = JSON.parse(await readFile(join(paths.dshHome, 'profiles', 'web', 'package.json'), 'utf8'));
			for (const name of DSH_AGENT_BUILTIN_PLUGINS) {
				assert.ok(manifest.dsh.profile.bundles.includes(name));
				assert.ok(await stat(join(paths.dshHome, 'profiles', 'web', 'node_modules', name)));
			}
			assert.ok(manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-base'));
			const second = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(second.pluginInstalled, true);
			assert.strictEqual(second.changed, false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('skips a built-in plugin that is not staged', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			const client = join(paths.runtimeRoot, 'plugin', 'dsh-client-tscode');
			await mkdir(client, { recursive: true });
			await writeFile(join(client, 'package.json'), '{"name":"dsh-client-tscode","version":"0.1.0"}');
			const prepared = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(prepared.pluginInstalled, true);
			const manifest = JSON.parse(await readFile(join(paths.dshHome, 'profiles', 'web', 'package.json'), 'utf8'));
			assert.ok(manifest.dsh.profile.bundles.includes('dsh-client-tscode'));
			assert.ok(!manifest.dsh.profile.bundles.includes('dsh-plugin-offline'));
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
			const withUserRow = '- id: user-plugin\n  disabled: true\n';
			await writeFile(patchPath, withUserRow);

			const second = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(second.changed, false);
			const patch = await readFile(patchPath, 'utf8');
			assert.strictEqual(patch, withUserRow);
			assert.ok(!patch.includes('tscode dsh-agent managed'));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('keeps an empty user patch as valid YAML', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			await prepareDshAgentProfile(paths, new NullLogService());
			const patchPath = join(paths.dshHome, 'cordis.patch.yml');
			await writeFile(patchPath, '[]\n');
			const prepared = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(prepared.changed, false);
			assert.strictEqual(await readFile(patchPath, 'utf8'), '[]\n');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('strips a legacy managed block and leaves a valid empty patch', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dsh-agent-profile-'));
		try {
			const paths = pathsFor(directory);
			const patchPath = join(paths.dshHome, 'cordis.patch.yml');
			await mkdir(paths.dshHome, { recursive: true });
			await writeFile(patchPath, [
				'# >>> tscode dsh-agent managed: do not edit this block >>>',
				'- id: plugin-manager',
				'  disabled: true',
				'- id: tool-plugin-manager',
				'  disabled: true',
				'# <<< tscode dsh-agent managed <<<',
				''
			].join('\n'));

			const prepared = await prepareDshAgentProfile(paths, new NullLogService());
			assert.strictEqual(prepared.changed, true);
			const patch = await readFile(patchPath, 'utf8');
			assert.strictEqual(patch, '[]\n');
			assert.ok(!patch.includes('tscode dsh-agent managed'));
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
//
// Vendor the pinned built-in dsh plugins into resources/dsh-agent/plugin.
// The files are copied verbatim into the application resources; nothing is
// installed from a registry at build time or at app runtime.
//
// Usage:
//   node scripts/dsh-agent/sync-builtin-plugins.mjs [--plugin <name>] [--from <dir>] [--check]
//
// Without --from, each plugin is read from the repository and revision pinned
// in resources/dsh-agent/builtin-plugins.json. --from copies a local checkout
// instead, which is useful while developing a plugin. --check verifies the
// vendored files without touching the network.

import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const from = valueOf('--from');
const only = valueOf('--plugin');
const pinPath = join(root, 'resources', 'dsh-agent', 'builtin-plugins.json');
const pluginRoot = join(root, 'resources', 'dsh-agent', 'plugin');

/** Runtime payload copied from a plugin repository; development files stay behind. */
const RUNTIME_ENTRIES = [
	'package.json',
	'cordis.patch.yml',
	'index.js',
	'client.js',
	'icon.svg',
	'src',
	'locale',
	'README.md',
	'README.zh-CN.md',
	'LICENSE'
];

function valueOf(flag) {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function git(cwd, ...gitArgs) {
	return execFileSync('git', gitArgs, { cwd, encoding: 'utf8' }).trim();
}

async function readPins() {
	const parsed = JSON.parse(await readFile(pinPath, 'utf8'));
	if (!Array.isArray(parsed.plugins) || parsed.plugins.length === 0) {
		throw new Error(`${pinPath} has no plugins`);
	}
	return parsed.plugins;
}

function selectPlugins(plugins) {
	if (only === undefined) {
		return plugins;
	}
	const selected = plugins.filter(plugin => plugin.name === only);
	if (selected.length === 0) {
		throw new Error(`No pinned plugin named ${JSON.stringify(only)} in ${pinPath}`);
	}
	return selected;
}

async function readManifest(directory, plugin) {
	const manifestPath = join(directory, 'package.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	if (manifest.name !== plugin.name) {
		throw new Error(`${manifestPath} declares ${JSON.stringify(manifest.name)}, expected ${JSON.stringify(plugin.name)}`);
	}
	if (manifest.version !== plugin.version) {
		throw new Error(`${manifestPath} is version ${JSON.stringify(manifest.version)}, pinned version is ${JSON.stringify(plugin.version)}`);
	}
	return manifest;
}

async function checkPlugin(plugin) {
	const directory = join(pluginRoot, plugin.name);
	const manifest = await readManifest(directory, plugin);
	const problems = [];
	for (const entry of ['package.json', 'cordis.patch.yml', 'src']) {
		if (!await exists(join(directory, entry))) {
			problems.push(`missing ${entry}`);
		}
	}
	const patch = manifest.dsh?.bundle?.patch;
	if (typeof patch !== 'string' || !await exists(join(directory, patch))) {
		problems.push('missing the bundle patch declared by dsh.bundle.patch');
	}
	const clientEntry = manifest.dsh?.client === undefined ? undefined : manifest.exports?.['./client'];
	if (typeof clientEntry === 'string' && !await exists(join(directory, clientEntry))) {
		problems.push(`missing client entry ${clientEntry}`);
	}
	if (typeof manifest.main === 'string' && !await exists(join(directory, manifest.main))) {
		problems.push(`missing main entry ${manifest.main}`);
	}
	if (problems.length > 0) {
		throw new Error(`${plugin.name}: ${problems.join(', ')}`);
	}
	console.log(`[builtin-plugins] ${plugin.name}@${plugin.version} is vendored and complete`);
}

async function copyPlugin(plugin, sourceDirectory) {
	const manifest = await readManifest(sourceDirectory, plugin);
	const destination = join(pluginRoot, plugin.name);
	await rm(destination, { recursive: true, force: true });
	await mkdir(destination, { recursive: true });
	for (const entry of RUNTIME_ENTRIES) {
		const source = join(sourceDirectory, entry);
		if (await exists(source)) {
			await cp(source, join(destination, entry), { recursive: true });
		}
	}
	await checkPlugin(plugin);
	console.log(`[builtin-plugins] vendored ${plugin.name}@${manifest.version} into ${destination}`);
}

async function checkout(plugin) {
	const directory = await mkdtemp(join(tmpdir(), 'dsh-builtin-plugin-'));
	try {
		git(undefined, 'clone', '--quiet', plugin.repository, directory);
		git(directory, 'checkout', '--quiet', '--detach', plugin.ref);
		const head = git(directory, 'rev-parse', 'HEAD');
		if (head !== plugin.ref) {
			throw new Error(`checked out ${head}, pinned revision is ${plugin.ref}`);
		}
		return directory;
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

async function main() {
	const plugins = selectPlugins(await readPins());
	if (from !== undefined && plugins.length > 1) {
		throw new Error('--from copies one repository; pass --plugin to select one plugin');
	}
	if (check) {
		for (const plugin of plugins) {
			await checkPlugin(plugin);
		}
		return;
	}
	for (const plugin of plugins) {
		if (from !== undefined) {
			await copyPlugin(plugin, resolve(from));
			continue;
		}
		const directory = await checkout(plugin);
		try {
			await copyPlugin(plugin, directory);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}

await main();

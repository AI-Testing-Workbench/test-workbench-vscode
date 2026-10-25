/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
//
// Stage the pinned dsh runtime and Node executable into resources/dsh-agent.
// This runs at packaging time, never at app runtime.
//
// Usage:
//   node scripts/dsh-agent/prepare-runtime.mjs [--dsh <pkg-dir>] [--node <exe>] [--out <dir>] [--check]

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const keepPrevious = args.includes('--keep-previous');
const out = resolve(valueOf('--out') ?? join(root, 'resources', 'dsh-agent'));
const dshDir = resolve(valueOf('--dsh') ?? process.env.TSCODE_DSH_AGENT_PACKAGE ?? '');
const nodeExe = resolve(valueOf('--node') ?? process.env.TSCODE_DSH_AGENT_NODE ?? process.execPath);
// CI overrides the pin with the fork artifact's actual version/revision.
const expectedDshOption = valueOf('--dsh-version');
const expectedForkRef = valueOf('--fork-ref');

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

/**
 * Copy top-level license files from the staged dependency tree and return one
 * notice row per package. Nested packages are represented by their parent.
 */
async function collectLicenses(nodeModulesDir, licensesRoot) {
	await rm(licensesRoot, { recursive: true, force: true });
	const packages = [];
	const entries = await readdir(nodeModulesDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) {
			continue;
		}
		if (entry.name.startsWith('@')) {
			for (const child of await readdir(join(nodeModulesDir, entry.name), { withFileTypes: true })) {
				if (child.isDirectory()) {
					packages.push({ name: `${entry.name}/${child.name}`, dir: join(nodeModulesDir, entry.name, child.name) });
				}
			}
		} else {
			packages.push({ name: entry.name, dir: join(nodeModulesDir, entry.name) });
		}
	}
	const rows = [];
	for (const pkg of packages.sort((a, b) => a.name.localeCompare(b.name))) {
		let version = 'unknown';
		let license = 'see package';
		try {
			const manifest = JSON.parse(await readFile(join(pkg.dir, 'package.json'), 'utf8'));
			version = manifest.version ?? version;
			license = typeof manifest.license === 'string' ? manifest.license : license;
		} catch {
			// A package without a readable manifest still appears in the notice.
		}
		const files = (await readdir(pkg.dir, { withFileTypes: true }).catch(() => []))
			.filter(entry => entry.isFile() && /^(LICEN[CS]E|COPYING|NOTICE)/i.test(entry.name))
			.map(entry => entry.name);
		const target = join(licensesRoot, pkg.name.replace('/', '__'));
		if (files.length > 0) {
			await mkdir(target, { recursive: true });
			for (const file of files) {
				await copyFile(join(pkg.dir, file), join(target, file));
			}
		}
		rows.push(`${pkg.name}@${version} (${license})${files.length > 0 ? ` -> licenses/${pkg.name.replace('/', '__')}/` : ''}`);
	}
	return rows;
}

async function readPin() {
	try {
		return JSON.parse(await readFile(join(root, 'resources', 'dsh-agent', 'runtime.json'), 'utf8'));
	} catch {
		return undefined;
	}
}

/** Built-in plugin sources vendored under resources/dsh-agent/plugin. */
async function readBuiltinPluginPins() {
	try {
		const pin = JSON.parse(await readFile(join(root, 'resources', 'dsh-agent', 'builtin-plugins.json'), 'utf8'));
		return Array.isArray(pin.plugins) ? pin.plugins : [];
	} catch {
		return [];
	}
}

/**
 * The build Node and the packaged Host Node must be the same version. CI runs
 * `prepare-runtime.mjs` from the repository while `.nvmrc` drives setup-node,
 * so checking the pair here catches drift before a 500 MB runtime copy.
 */
async function readBuildNodeVersion() {
	try {
		return (await readFile(join(root, '.nvmrc'), 'utf8')).trim().replace(/^v/, '');
	} catch {
		return undefined;
	}
}

async function nodePinMismatch(pin) {
	const buildNode = await readBuildNodeVersion();
	if (pin?.node && buildNode && pin.node !== buildNode) {
		return `.nvmrc pins Node ${buildNode}, but resources/dsh-agent/runtime.json pins ${pin.node}`;
	}
	return undefined;
}

function pnpmShimPath(runtimeRoot) {
	return process.platform === 'win32'
		? join(runtimeRoot, 'node', 'pnpm.cmd')
		: join(runtimeRoot, 'node', 'bin', 'pnpm');
}

/**
 * Expose the staged pnpm package on the same PATH directory as the bundled
 * Node. The Host prepends that directory for every child process, so the
 * plugin manager's default `pnpm` command resolves without a global install.
 */
async function writePnpmShim(runtimeRoot) {
	const shim = pnpmShimPath(runtimeRoot);
	await mkdir(dirname(shim), { recursive: true });
	if (process.platform === 'win32') {
		await writeFile(shim, [
			'@echo off',
			'"%~dp0node.exe" "%~dp0..\\app\\node_modules\\pnpm\\bin\\pnpm.mjs" %*',
			''
		].join('\r\n'));
		return;
	}
	await writeFile(shim, [
		'#!/bin/sh',
		'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
		'exec "$DIR/node" "$DIR/../../app/node_modules/pnpm/bin/pnpm.mjs" "$@"',
		''
	].join('\n'));
	await chmod(shim, 0o755);
}

async function readVersion(packageDir) {
	const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
	if (!manifest.name || !manifest.version) {
		throw new Error(`${packageDir} is not an npm package`);
	}
	if (manifest.name !== '@deepseek-ai/dsh') {
		throw new Error(`Expected @deepseek-ai/dsh, found ${manifest.name}`);
	}
	return manifest.version;
}

async function checkRuntime() {
	const problems = [];
	const pin = await readPin();
	const expectedDshVersion = expectedDshOption ?? pin?.dsh;
	const expectedForkRevision = expectedForkRef ?? pin?.fork?.ref;
	const pinProblem = await nodePinMismatch(pin);
	if (pinProblem) {
		problems.push(pinProblem);
	}
	const nodePath = process.platform === 'win32' ? join(out, 'node', 'node.exe') : join(out, 'node', 'bin', 'node');
	if (!await exists(nodePath)) {
		problems.push('missing node executable');
	} else if (pin?.node) {
		const stagedNode = execFileSync(nodePath, ['--version'], { encoding: 'utf8' }).trim().replace(/^v/, '');
		if (stagedNode !== pin.node) {
			problems.push(`Node ${stagedNode} (expected ${pin.node})`);
		}
	}
	const dshManifest = join(out, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
	if (await exists(dshManifest)) {
		const stagedDsh = JSON.parse(await readFile(dshManifest, 'utf8')).version;
		if (expectedDshVersion && stagedDsh !== expectedDshVersion) {
			problems.push(`dsh ${stagedDsh} (expected ${expectedDshVersion})`);
		}
	}
	if (pin?.pnpm) {
		const pnpmManifest = join(out, 'app', 'node_modules', 'pnpm', 'package.json');
		if (!await exists(pnpmManifest)) {
			problems.push(`missing pnpm ${pin.pnpm} package (re-run install-runtime-from-tarballs.mts)`);
		} else {
			const stagedPnpm = JSON.parse(await readFile(pnpmManifest, 'utf8')).version;
			if (stagedPnpm !== pin.pnpm) {
				problems.push(`pnpm ${stagedPnpm} (expected ${pin.pnpm})`);
			}
		}
		const shim = pnpmShimPath(out);
		if (!await exists(shim)) {
			problems.push('missing pnpm shim');
		} else {
			try {
				const shimVersion = execFileSync(shim, ['--version'], {
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
					...(process.platform === 'win32' ? { shell: true } : {})
				}).trim();
				if (pin.pnpm && shimVersion !== pin.pnpm) {
					problems.push(`pnpm shim reports ${shimVersion} (expected ${pin.pnpm})`);
				}
			} catch (error) {
				problems.push(`pnpm shim failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	if (!await exists(join(out, 'plugin', 'dsh-client-tscode', 'package.json'))) {
		problems.push('missing dsh-client-tscode plugin');
	}
	// test-workbench_change start
	for (const plugin of await readBuiltinPluginPins()) {
		const pluginDir = join(out, 'plugin', plugin.name);
		const manifestPath = join(pluginDir, 'package.json');
		if (!await exists(manifestPath)) {
			problems.push(`missing built-in plugin ${plugin.name}`);
			continue;
		}
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		if (manifest.version !== plugin.version) {
			problems.push(`built-in plugin ${plugin.name} ${manifest.version} (expected ${plugin.version})`);
		}
		const patch = manifest?.dsh?.bundle?.patch;
		if (typeof patch !== 'string' || !await exists(join(pluginDir, patch))) {
			problems.push(`built-in plugin ${plugin.name} has no bundle patch`);
		}
		if (typeof manifest.main === 'string' && !await exists(join(pluginDir, manifest.main))) {
			problems.push(`built-in plugin ${plugin.name} has no main entry`);
		}
		const clientEntry = manifest?.dsh?.client === undefined ? undefined : manifest?.exports?.['./client'];
		if (typeof clientEntry === 'string' && !await exists(join(pluginDir, clientEntry))) {
			problems.push(`built-in plugin ${plugin.name} has no client entry`);
		}
	}
	// test-workbench_change end
	if (!await exists(join(out, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
		problems.push('missing dsh CLI entry');
	}
	// test-workbench_change start
	// pi-ai imports this dotfile at startup. Packaging filters that ignore
	// dotfiles silently drop it, which makes dsh-llm-pi-ai fail to import.
	const piAiRoot = join(out, 'app', 'node_modules', '@earendil-works', 'pi-ai');
	const piAiManifest = join(piAiRoot, 'dist', 'providers', 'data', '.manifest.json');
	if (await exists(join(piAiRoot, 'package.json')) && !await exists(piAiManifest)) {
		problems.push('missing @earendil-works/pi-ai model manifest');
	}
	// test-workbench_change end
	if (!await exists(join(out, 'web', 'index.html'))) {
		problems.push('missing web frontend');
	}
	if (!await exists(join(out, 'VERSION'))) {
		problems.push('missing VERSION');
	} else if (expectedForkRevision) {
		const version = await readFile(join(out, 'VERSION'), 'utf8');
		if (!version.includes(`fork ${expectedForkRevision}`)) {
			problems.push(`fork ${expectedForkRevision} (VERSION does not record the fork revision)`);
		}
	}
	if (problems.length > 0) {
		console.error(`[dsh-agent] runtime check failed at ${out}: ${problems.join(', ')}`);
		process.exitCode = 1;
		return;
	}
	console.log(`[dsh-agent] runtime OK at ${out}`);
	console.log(await readFile(join(out, 'VERSION'), 'utf8'));
}

async function prepare() {
	if (!dshDir || !await exists(join(dshDir, 'package.json'))) {
		throw new Error('Pass --dsh <path to @deepseek-ai/dsh package> or set TSCODE_DSH_AGENT_PACKAGE');
	}
	const dshVersion = await readVersion(dshDir);
	const nodeVersion = execFileSync(nodeExe, ['--version'], { encoding: 'utf8' }).trim().replace(/^v/, '');
	const pin = await readPin();
	const expectedDshVersion = expectedDshOption ?? pin?.dsh;
	const expectedForkRevision = expectedForkRef ?? pin?.fork?.ref;
	const pinProblem = await nodePinMismatch(pin);
	if (pinProblem) {
		throw new Error(pinProblem);
	}
	if (expectedDshVersion && dshVersion !== expectedDshVersion) {
		throw new Error(`dsh ${dshVersion} does not match the pinned runtime ${pin.dsh}`);
	}
	if (pin?.node ? nodeVersion !== pin.node : !/^24\.18\./.test(nodeVersion)) {
		throw new Error(`Node ${pin?.node ?? '24.18.x'} is required at ${nodeExe} (found ${nodeVersion})`);
	}
	if (!pin?.pnpm) {
		throw new Error('resources/dsh-agent/runtime.json must pin pnpm for the embedded plugin manager');
	}
	// `--dsh` must live in a dedicated npm prefix. Copying its whole node_modules
	// preserves hoisted dependencies; copying only the dsh package would miss them.
	const dshNodeModules = dirname(dirname(dshDir));
	if (basename(dshNodeModules) !== 'node_modules' || basename(dirname(dshDir)) !== '@deepseek-ai') {
		throw new Error(`--dsh must be <prefix>/node_modules/@deepseek-ai/dsh (got ${dshDir})`);
	}
	const webDist = [
		join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist'),
		join(dshNodeModules, '@deepseek-ai', 'dsh-web-frontend', 'dist')
	].find(candidate => existsSync(join(candidate, 'index.html')));
	if (!webDist) {
		throw new Error(`dsh web frontend dist was not found under ${dshNodeModules}`);
	}

	// The plugin source and README live in resources/dsh-agent and must survive
	// restaging. Only runtime payloads are replaced.
	await mkdir(out, { recursive: true });
	if (keepPrevious && await exists(out)) {
		const previous = join(out, 'previous');
		await rm(previous, { recursive: true, force: true });
		await mkdir(previous, { recursive: true });
		for (const entry of ['app', 'node', 'web', 'VERSION', 'THIRD_PARTY_NOTICES']) {
			if (await exists(join(out, entry))) {
				await rename(join(out, entry), join(previous, entry));
			}
		}
	} else {
		for (const entry of ['app', 'node', 'web', 'VERSION', 'THIRD_PARTY_NOTICES']) {
			await rm(join(out, entry), { recursive: true, force: true });
		}
	}
	// test-workbench_change start
	// Windows keeps `node/node.exe`, macOS/Linux use `node/bin/node`. Do not append
	// another path segment to the Windows target: it resolves to `node.exe/node`.
	const nodeTarget = process.platform === 'win32'
		? join(out, 'node', 'node.exe')
		: join(out, 'node', 'bin', 'node');
	await mkdir(dirname(nodeTarget), { recursive: true });
	// test-workbench_change end
	await copyFile(nodeExe, nodeTarget);
	await chmod(nodeTarget, 0o755);

	const appRoot = join(out, 'app', 'node_modules');
	await mkdir(appRoot, { recursive: true });
	await cp(dshNodeModules, appRoot, {
		recursive: true,
		dereference: false,
		filter: source => basename(source) !== '.bin'
	});
	if (!await exists(join(appRoot, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
		throw new Error(`staged node_modules is missing @deepseek-ai/dsh: ${appRoot}`);
	}
	await cp(webDist, join(out, 'web'), { recursive: true });

	const pnpmManifest = join(appRoot, 'pnpm', 'package.json');
	if (!await exists(pnpmManifest)) {
		throw new Error(`staged runtime is missing pnpm ${pin.pnpm}; run install-runtime-from-tarballs.mts with the current pin`);
	}
	const stagedPnpm = JSON.parse(await readFile(pnpmManifest, 'utf8')).version;
	if (stagedPnpm !== pin.pnpm) {
		throw new Error(`staged pnpm is ${stagedPnpm}, expected ${pin.pnpm}`);
	}
	await writePnpmShim(out);

	const pluginSource = join(root, 'resources', 'dsh-agent', 'plugin');
	if (pluginSource !== join(out, 'plugin') && await exists(pluginSource)) {
		await cp(pluginSource, join(out, 'plugin'), { recursive: true });
	}

	const licenseRows = await collectLicenses(appRoot, join(out, 'licenses'));
	// test-workbench_change start
	const builtinRows = [];
	for (const plugin of await readBuiltinPluginPins()) {
		try {
			const manifest = JSON.parse(await readFile(join(out, 'plugin', plugin.name, 'package.json'), 'utf8'));
			builtinRows.push(`${plugin.name} ${manifest.version} (${manifest.license ?? 'see package'})`);
		} catch {
			builtinRows.push(`${plugin.name} ${plugin.version} (see resources/dsh-agent/plugin)`);
		}
	}
	// test-workbench_change end
	const notices = [
		'# Third-party notices for the embedded dsh runtime',
		'',
		`@deepseek-ai/dsh ${dshVersion}`,
		`Node.js ${nodeVersion}`,
		// test-workbench_change start
		...(builtinRows.length > 0 ? ['', 'Built-in plugins:', ...builtinRows] : []),
		// test-workbench_change end
		'',
		'License texts are collected under licenses/. Packages without a top-level',
		'LICENSE/COPYING/NOTICE file are listed with their declared license.',
		'',
		...licenseRows
	].join('\n');
	await writeFile(join(out, 'THIRD_PARTY_NOTICES'), notices + '\n');
	const fork = expectedForkRevision ? ` / fork ${expectedForkRevision}` : '';
	await writeFile(join(out, 'VERSION'), `dsh ${dshVersion} / node v${nodeVersion}${fork} / format 1 / ${new Date().toISOString()}\n`);
	console.log(`[dsh-agent] staged dsh ${dshVersion}, Node ${nodeVersion}, and pnpm ${stagedPnpm}${fork} at ${out}`);
}

if (check) {
	await checkRuntime();
} else {
	await prepare();
	await checkRuntime();
}

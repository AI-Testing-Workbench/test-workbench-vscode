/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
//
// Install the dsh Agent runtime from a set of packed npm tarballs.
//
// The dsh fork is built and packed once per revision; each platform then runs
// this script to resolve its own native dependencies from the public registry.
// The dependency closure starts at @deepseek-ai/dsh so experimental packages
// that happen to be packed next to the product are not installed.
//
// Usage:
//   node scripts/dsh-agent/install-runtime-from-tarballs.mts \
//     --from <packed dir> [--from ...] [--out .build/dsh-runtime]
//
// Every --from directory may contain a manifest.json (or SHA256SUMS) produced by
// the fork build. When present it is verified before installing.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface PackedManifest {
	readonly name: string;
	readonly version: string;
	readonly scripts?: Record<string, string>;
	readonly dependencies?: Record<string, string>;
	readonly optionalDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
}

interface PackedPackage {
	readonly manifest: PackedManifest;
	readonly tarball: string;
	readonly verified: boolean;
}

interface RuntimeManifestEntry {
	readonly tarball?: string;
	readonly sha256?: string;
}

interface RuntimeManifest {
	readonly packages?: RuntimeManifestEntry[];
}

interface RuntimePin {
	readonly pnpm?: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const out = resolve(valueOf('--out') ?? join(root, '.build', 'dsh-runtime'));
const from = valuesOf('--from').map(directory => resolve(directory));
const entryPackage = '@deepseek-ai/dsh';
const webPackage = '@deepseek-ai/dsh-web-frontend';

if (from.length === 0) {
	throw new Error('Pass at least one --from <packed directory>');
}
for (const directory of from) {
	if (!existsSync(directory)) {
		throw new Error(`Packed directory does not exist: ${directory}`);
	}
}

function valueOf(flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}

function valuesOf(flag: string): string[] {
	return args.flatMap((argument, index) => argument === flag ? [args[index + 1]] : []);
}

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readPackedManifest(path: string): PackedManifest {
	return JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as PackedManifest;
}

async function readJson<T>(path: string): Promise<T | undefined> {
	let text: string;
	try {
		text = await readFile(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Verify a packed directory's optional manifest. The fork build writes
 * manifest.json; SHA256SUMS covers older outputs. A directory without either is
 * accepted so local development does not need a release step, but the combined
 * digest is always printed for provenance.
 */
async function verifyDirectory(directory: string): Promise<Set<string>> {
	const manifestPath = join(directory, 'manifest.json');
	const manifest = await readJson<RuntimeManifest>(manifestPath);
	const verified = new Set<string>();
	if (manifest !== undefined) {
		if (!Array.isArray(manifest.packages)) {
			throw new Error(`${manifestPath} has no packages array`);
		}
		for (const entry of manifest.packages) {
			if (typeof entry.tarball !== 'string' || typeof entry.sha256 !== 'string') {
				throw new Error(`${manifestPath} has an invalid package entry`);
			}
			const tarball = join(directory, entry.tarball);
			if (!existsSync(tarball)) {
				throw new Error(`manifest lists a missing tarball: ${entry.tarball}`);
			}
			const actual = sha256(tarball);
			if (actual !== entry.sha256) {
				throw new Error(`sha256 mismatch for ${entry.tarball}: expected ${entry.sha256}, got ${actual}`);
			}
			verified.add(entry.tarball);
		}
		console.log(`[dsh-agent] verified ${String(verified.size)} tarball(s) from ${manifestPath}`);
	}
	const sumsPath = join(directory, 'SHA256SUMS');
	if (verified.size === 0 && existsSync(sumsPath)) {
		for (const line of (await readFile(sumsPath, 'utf8')).split(/\r?\n/u)) {
			const match = /^([0-9a-f]{64})\s+\*?(.+)$/iu.exec(line.trim());
			if (!match) {
				continue;
			}
			const tarball = join(directory, match[2]);
			if (!existsSync(tarball)) {
				throw new Error(`SHA256SUMS lists a missing tarball: ${match[2]}`);
			}
			if (sha256(tarball) !== match[1].toLowerCase()) {
				throw new Error(`sha256 mismatch for ${match[2]}`);
			}
			verified.add(match[2]);
		}
		console.log(`[dsh-agent] verified ${String(verified.size)} tarball(s) from ${sumsPath}`);
	}
	return verified;
}

const packed = new Map<string, PackedPackage>();
const digestRows: string[] = [];
for (const directory of from) {
	const verified = await verifyDirectory(directory);
	const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort();
	const unlisted = tarballs.filter(name => !verified.has(name));
	if (verified.size > 0 && unlisted.length > 0) {
		throw new Error(`${directory} has tarballs missing from its manifest: ${unlisted.join(', ')}`);
	}
	for (const filename of tarballs) {
		const tarball = join(directory, filename);
		const manifest = readPackedManifest(tarball);
		if (packed.has(manifest.name)) {
			throw new Error(`${manifest.name} is packed twice`);
		}
		packed.set(manifest.name, { manifest, tarball, verified: verified.has(filename) });
		digestRows.push(`${sha256(tarball)}  ${filename}`);
	}
}
console.log(`[dsh-agent] read ${String(packed.size)} packed package(s) from ${String(from.length)} director${from.length === 1 ? 'y' : 'ies'}`);
const unverified = [...packed.values()].filter(pkg => !pkg.verified).length;
if (unverified > 0) {
	console.warn(`[dsh-agent] ${String(unverified)} tarball(s) have no manifest entry; relying on the pinned fork revision`);
}

const entry = packed.get(entryPackage);
if (entry === undefined) {
	throw new Error(`${entryPackage} is not among the packed tarballs`);
}

// The embedded Host has no package manager of its own. Install the pinned pnpm
// package next to dsh so the staged runtime can expose a `pnpm` shim without
// depending on a globally installed pnpm.
const pin = await readJson<RuntimePin>(join(root, 'resources', 'dsh-agent', 'runtime.json'));
const pnpmVersion = pin?.pnpm;
if (pnpmVersion === undefined) {
	throw new Error('resources/dsh-agent/runtime.json must pin pnpm for the embedded plugin manager');
}

// Follow install and peer dependencies through the packed set. External
// dependencies are left to npm, which resolves the platform-specific native
// packages for the machine running this script.
//
// Optional-only packages must stay optional at the root as well. Otherwise npm
// treats a macOS-only package (for example dsh-experimental-cua-macos) as a
// required dependency on Windows/Linux and fails with EBADPLATFORM.
const required = new Set<string>();
const optional = new Set<string>();
const visit = (name: string, isRequired: boolean): void => {
	const pkg = packed.get(name);
	if (pkg === undefined) {
		return;
	}
	if (required.has(name)) {
		return;
	}
	if (!isRequired && optional.has(name)) {
		return;
	}
	if (isRequired) {
		required.add(name);
		optional.delete(name);
	} else {
		optional.add(name);
	}
	for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
		visit(dependency, isRequired);
	}
	for (const dependency of Object.keys(pkg.manifest.peerDependencies ?? {})) {
		visit(dependency, isRequired);
	}
	for (const dependency of Object.keys(pkg.manifest.optionalDependencies ?? {})) {
		visit(dependency, false);
	}
};
visit(entryPackage, true);
const closure = new Set([...required, ...optional]);
if (!required.has(webPackage)) {
	throw new Error(`${webPackage} is not reachable from ${entryPackage}`);
}
console.log(`[dsh-agent] closure: ${String(required.size)} required, ${String(optional.size)} optional`);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// npm 11.16 defaults lifecycle scripts to a warn-only allowlist. Registry
// packages match by name, while file: dependencies only match their exact
// resolved URL, so both forms are generated here.
const allowScripts: Record<string, boolean> = {
	'koffi': true,
	'node-pty': true,
	'@google/genai': false,
	'protobufjs': false
};
for (const name of closure) {
	const pkg = packed.get(name);
	if (pkg === undefined) {
		continue;
	}
	const scripts = pkg.manifest.scripts;
	if (scripts !== undefined && ['preinstall', 'install', 'postinstall', 'prepare'].some(script => typeof scripts[script] === 'string')) {
		allowScripts[pathToFileURL(pkg.tarball).href] = true;
	}
}

const dependencies: Record<string, string> = {
	pnpm: pnpmVersion
};
for (const name of [...required].sort()) {
	const pkg = packed.get(name);
	if (pkg !== undefined) {
		dependencies[name] = pathToFileURL(pkg.tarball).href;
	}
}
const optionalDependencies: Record<string, string> = {};
for (const name of [...optional].sort()) {
	const pkg = packed.get(name);
	if (pkg !== undefined) {
		optionalDependencies[name] = pathToFileURL(pkg.tarball).href;
	}
}
await writeFile(join(out, 'package.json'), JSON.stringify({
	name: 'dsh-agent-runtime',
	version: '0.0.0',
	private: true,
	dependencies,
	...(Object.keys(optionalDependencies).length > 0 ? { optionalDependencies } : {}),
	allowScripts
}, null, 2) + '\n');
await writeFile(join(out, 'TARBALL_SHA256SUMS'), `${digestRows.sort().join('\n')}\n`);

console.log(`[dsh-agent] installing ${String(closure.size)} dsh package(s) and pnpm@${pnpmVersion} into ${out}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', '--loglevel=warn'], {
	cwd: out,
	stdio: 'inherit',
	shell: process.platform === 'win32'
});

// The packed dsh package needs this postinstall to restore node-pty's helper
// mode. Run it explicitly so the result does not depend on npm's allowScripts
// identity matching for a file: dependency.
const spawnHelper = join(out, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'scripts', 'ensure-spawn-helper.mjs');
if (existsSync(spawnHelper)) {
	execFileSync(process.execPath, [spawnHelper], { cwd: out, stdio: 'inherit' });
}

const entryPath = join(out, 'node_modules', ...entryPackage.split('/'), 'lib', 'bin.js');
const webPath = join(out, 'node_modules', ...webPackage.split('/'), 'dist', 'index.html');
for (const path of [entryPath, webPath]) {
	if (!existsSync(path)) {
		throw new Error(`Installed runtime is missing ${path}`);
	}
}

const installedVersion = (JSON.parse(await readFile(join(out, 'node_modules', ...entryPackage.split('/'), 'package.json'), 'utf8')) as { version: string }).version;
if (installedVersion !== entry.manifest.version) {
	throw new Error(`Installed ${entryPackage} is ${installedVersion}, expected ${entry.manifest.version}`);
}
const installedPnpm = (JSON.parse(await readFile(join(out, 'node_modules', 'pnpm', 'package.json'), 'utf8')) as { version: string }).version;
if (installedPnpm !== pnpmVersion) {
	throw new Error(`Installed pnpm is ${installedPnpm}, expected ${pnpmVersion}`);
}
console.log(`[dsh-agent] installed dsh ${installedVersion} with ${String(closure.size)} dsh package(s) and pnpm ${installedPnpm}`);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { existsSync, readFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { delimiter, dirname, join, resolve } from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { DSH_AGENT_LOG_DIRECTORY } from '../common/dshAgent.js';
import { DEFAULT_DSH_AGENT_WINDOW_SETTINGS, IDshAgentPaths, IDshAgentWindowSettings } from '../common/dshAgentPaths.js';

/**
 * Resolve every path the Agent needs.
 * The runtime is always `<appRoot>/resources/dsh-agent`; the same layout works
 * in development (repository root) and in packaged builds.
 */
export function resolveDshAgentPaths(appRoot: string, userDataPath: string, settings: IDshAgentWindowSettings): IDshAgentPaths {
	const runtimeRoot = join(appRoot, 'resources', 'dsh-agent');
	const bundledNode = isWindows ? join(runtimeRoot, 'node', 'node.exe') : join(runtimeRoot, 'node', 'bin', 'node');
	const bundledEntry = join(runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
	const webDist = join(runtimeRoot, 'web');

	const node = settings.nodePath
		?? process.env['TSCODE_DSH_AGENT_NODE']
		?? (existsSync(bundledNode) ? bundledNode : findExecutable('node') ?? process.execPath);
	const dshEntry = settings.dshEntry
		?? process.env['TSCODE_DSH_AGENT_DSH_ENTRY']
		?? (existsSync(bundledEntry) ? bundledEntry : undefined);
	const globalEntry = dshEntry ?? resolveGlobalDsh();
	const dshCommand = globalEntry ? undefined : findExecutable('dsh');

	const dshHome = resolve(settings.dshHome ?? process.env['TSCODE_DSH_AGENT_HOME'] ?? join(homedir(), '.tscode-dsh'));
	const logDirectory = join(userDataPath, 'logs', DSH_AGENT_LOG_DIRECTORY);

	return {
		runtimeRoot,
		node,
		dshEntry: globalEntry,
		dshCommand,
		dshHome,
		logDirectory,
		profile: settings.profile || DEFAULT_DSH_AGENT_WINDOW_SETTINGS.profile,
		webDist: existsSync(join(webDist, 'index.html')) ? webDist : undefined,
		runtimeVersion: readRuntimeVersion(runtimeRoot)
	};
}

function readRuntimeVersion(runtimeRoot: string): string | undefined {
	const versionFile = join(runtimeRoot, 'VERSION');
	try {
		const content = readFileSync(versionFile, 'utf8');
		const version = content.trim();
		return version.length > 0 && version.length <= 128 ? version : undefined;
	} catch {
		return undefined;
	}
}

/** Find an executable on PATH, including `.cmd`/`.exe` variants on Windows. */
export function findExecutable(name: string): string | undefined {
	const pathValue = process.env['PATH'] ?? '';
	const directories = pathValue.split(delimiter);
	const extensions = isWindows
		? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').map(extension => extension.toLowerCase())
		: [''];
	for (const directory of directories) {
		if (!directory) {
			continue;
		}
		for (const extension of extensions) {
			const candidate = join(directory, isWindows ? `${name}${extension}` : name);
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

/**
 * Development fallback: infer the CLI package from a globally installed `dsh`.
 * The npm launcher is a symlink; its target lives next to the package's `lib/bin.js`.
 */
function resolveGlobalDsh(): string | undefined {
	const dsh = findExecutable('dsh');
	if (!dsh) {
		return undefined;
	}
	try {
		const real = realpathSync(dsh);
		if (real.endsWith(join('lib', 'bin.js'))) {
			return real;
		}
		// nvm/Homebrew shims: <prefix>/bin/dsh -> <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
		const prefixEntry = join(dirname(dirname(real)), 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
		if (existsSync(prefixEntry)) {
			return prefixEntry;
		}
	} catch {
		// A broken symlink behaves like a missing CLI.
	}
	return undefined;
}

/** Environment passed to the Host process. */
export function createDshAgentHostEnvironment(paths: IDshAgentPaths, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {
		...base,
		DSH_HOME: paths.dshHome,
		DSH_DESKTOP: '1'
	};
	delete environment['ELECTRON_RUN_AS_NODE'];
	// A bundled Node must own `node` lookups performed by plugins and package managers.
	const nodeDirectory = dirname(paths.node);
	const inheritedPath = environment['PATH'] ?? '';
	environment['PATH'] = inheritedPath.length > 0 ? `${nodeDirectory}${delimiter}${inheritedPath}` : nodeDirectory;
	return environment;
}

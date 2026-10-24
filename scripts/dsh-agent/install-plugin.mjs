/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
//
// Install the packaged dsh client bridge into the isolated tscode profile.
// The preload fallback keeps file links working without this step; installing
// the plugin adds context events and theme attributes for dsh UI extensions.
//
// Usage: node scripts/dsh-agent/install-plugin.mjs [--profile web] [--home ~/.tscode-dsh]

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const valueOf = flag => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};
const profile = valueOf('--profile') ?? 'web';
const home = resolve(valueOf('--home') ?? process.env.TSCODE_DSH_AGENT_HOME ?? join(homedir(), '.tscode-dsh'));
const plugin = resolve(valueOf('--plugin') ?? join(root, 'resources', 'dsh-agent', 'plugin', 'dsh-client-tscode'));

const child = spawn('dsh', ['plugin', '--profile', profile, 'add', plugin], {
	stdio: 'inherit',
	env: { ...process.env, DSH_HOME: home }
});
child.once('error', error => {
	console.error(`[dsh-agent] could not run dsh: ${error.message}`);
	process.exitCode = 1;
});
child.once('exit', code => {
	if (code === 0) {
		console.log(`[dsh-agent] installed ${plugin} into ${profile} (DSH_HOME=${home})`);
	} else {
		console.error(`[dsh-agent] dsh plugin exited with ${code}`);
		process.exitCode = code ?? 1;
	}
});

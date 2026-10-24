/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
//
// Swap the staged runtime with the snapshot retained by
// `prepare-runtime.mjs --keep-previous`.
//
// Usage: node scripts/dsh-agent/rollback-runtime.mjs [--out <dir>]

import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const index = args.indexOf('--out');
const out = resolve(index >= 0 ? args[index + 1] : join(root, 'resources', 'dsh-agent'));
const previous = join(out, 'previous');

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

if (!await exists(previous)) {
	console.error(`[dsh-agent] no previous runtime at ${previous}`);
	process.exitCode = 1;
	process.exit();
}

const temporary = join(out, '.rollback-current');
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });

for (const entry of await readdir(previous)) {
	await rename(join(previous, entry), join(temporary, 'restore-' + entry)).catch(() => undefined);
}
for (const entry of await readdir(out)) {
	if (entry === 'previous' || entry === '.rollback-current') {
		continue;
	}
	await rename(join(out, entry), join(temporary, entry)).catch(() => undefined);
}
for (const entry of await readdir(temporary)) {
	if (entry.startsWith('restore-')) {
		await rename(join(temporary, entry), join(out, entry.slice('restore-'.length)));
	}
}
await rm(previous, { recursive: true, force: true });
await rename(temporary, previous);
console.log(`[dsh-agent] restored the previous runtime at ${out}`);

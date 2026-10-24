/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
//
// Print the packaged dsh Agent runtime size by top-level directory.
// Usage: node scripts/dsh-agent/size-report.mjs [--json]

import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = resolve(process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : join(root, 'resources', 'dsh-agent'));

async function sizeOf(path) {
	let total = 0;
	const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) {
			total += await sizeOf(child);
		} else if (entry.isFile()) {
			total += (await stat(child)).size;
		}
	}
	return total;
}

const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
if (entries.length === 0) {
	console.error(`[dsh-agent] nothing staged at ${target}`);
	process.exitCode = 1;
} else {
	const rows = [];
	let total = 0;
	for (const entry of entries) {
		const size = entry.isDirectory() ? await sizeOf(join(target, entry.name)) : (await stat(join(target, entry.name))).size;
		rows.push({ name: entry.name, bytes: size });
		total += size;
	}
	rows.sort((a, b) => b.bytes - a.bytes);
	if (process.argv.includes('--json')) {
		console.log(JSON.stringify({ target, total, rows }, undefined, '\t'));
	} else {
		for (const row of rows) {
			console.log(`${(row.bytes / 1024 / 1024).toFixed(1).padStart(8)} MB  ${row.name}`);
		}
		console.log(`${(total / 1024 / 1024).toFixed(1).padStart(8)} MB  total (${target})`);
	}
}

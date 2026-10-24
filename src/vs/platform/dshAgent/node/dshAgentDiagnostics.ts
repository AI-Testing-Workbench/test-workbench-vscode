/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import { join } from '../../../base/common/path.js';
import { redactDshAgentLog } from '../common/dshAgent.js';
import { IDshAgentProfileInfo } from './dshAgentProfile.js';

const MAX_CRASH_REPORTS = 10;

/** Facts included in a Host crash report; never prompts, code, or file contents. */
export interface IDshAgentCrashReport {
	readonly source: 'host-start' | 'host-exit' | 'renderer' | 'bridge';
	readonly message: string;
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly stderrTail: string;
	readonly restartCount: number;
	readonly safeMode: boolean;
	readonly hostWorkspace: string | undefined;
	readonly profile: IDshAgentProfileInfo | undefined;
	readonly runtimeVersion: string | undefined;
	readonly versions: {
		readonly app: string;
		readonly electron: string;
		readonly node: string;
		readonly chrome: string;
	};
	readonly time: string;
}

/** Persist one crash report and prune older reports. */
export async function writeDshAgentCrashReport(logDirectory: string, report: IDshAgentCrashReport): Promise<string> {
	await mkdir(logDirectory, { recursive: true });
	const filename = `crash-${Date.now()}.json`;
	const path = join(logDirectory, filename);
	const payload: IDshAgentCrashReport = {
		...report,
		message: redactDshAgentLog(report.message),
		stderrTail: redactDshAgentLog(report.stderrTail)
	};
	await writeFile(path, JSON.stringify(payload, undefined, '\t') + '\n', { mode: 0o600 });
	await pruneCrashReports(logDirectory);
	return path;
}

async function pruneCrashReports(logDirectory: string): Promise<void> {
	try {
		const entries = (await readdir(logDirectory))
			.filter(name => name.startsWith('crash-') && name.endsWith('.json'))
			.sort();
		for (const entry of entries.slice(0, Math.max(0, entries.length - MAX_CRASH_REPORTS))) {
			await rm(join(logDirectory, entry), { force: true });
		}
	} catch {
		// Pruning is best effort.
	}
}

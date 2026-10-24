/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { ChildProcess, spawn, spawnSync } from 'child_process';
import { isWindows } from '../../../base/common/platform.js';
import { isLoopbackHttpUrl, parseDshHostReadyLine, redactDshAgentLog } from '../common/dshAgent.js';

const MAX_LOG_CHARS = 64 * 1024;
const DEFAULT_READY_TIMEOUT_MS = 90_000;
const STOP_GRACE_MS = 10_000;
const STOP_KILL_TIMEOUT_MS = 5_000;

/** Successful Host startup facts. */
export interface IDshAgentHostReady {
	/** Authenticated URL including the one-time token; never sent to the renderer. */
	readonly url: string;
	/** Origin used by the proxied application and the WebSocket fence. */
	readonly origin: string;
	/** Authority cookie issued by the Host. */
	readonly cookie: string;
}

/** Options for one Host child process. */
export interface IDshAgentHostOptions {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly readyTimeoutMs?: number;
	readonly fetch?: typeof fetch;
	readonly onLog?: (level: 'info' | 'error', message: string) => void;
}

/** Error carrying the CLI's stderr tail for diagnostics. */
export class DshAgentHostStartError extends Error {
	constructor(message: string, readonly stderrTail: string, readonly exitCode: number | null) {
		super(message);
	}
}

/**
 * Own one `dsh web` child. The class has no Electron dependency so it can be
 * exercised by the Node unit suite and by the runtime smoke script.
 */
export class DshAgentHostProcess {

	private child: ChildProcess | undefined;
	private stdoutBuffer = '';
	private stderrBuffer = '';
	private stdoutTail = '';
	private stderrTail = '';
	private readyUrlSeen = false;
	private authenticated: IDshAgentHostReady | undefined;
	private readyResolve: ((ready: IDshAgentHostReady) => void) | undefined;
	private readyReject: ((error: Error) => void) | undefined;
	private readonly readyPromise: Promise<IDshAgentHostReady>;
	private exitPromise: Promise<void> | undefined;
	private exitResolve: (() => void) | undefined;
	private stopping = false;
	private lastExitCode: number | null = null;
	private lastSignal: NodeJS.Signals | null = null;
	private lastFailure: Error | undefined;

	constructor(private readonly options: IDshAgentHostOptions) {
		this.readyPromise = new Promise<IDshAgentHostReady>((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
		});
		// A Host that fails before the caller awaits `start` must not surface as an
		// unhandled rejection; `start` re-raises the same error to its caller.
		this.readyPromise.catch(() => undefined);
	}

	get pid(): number | undefined {
		return this.child?.pid;
	}

	/** Exit code of the child, when it has exited. */
	get exitCode(): number | null {
		return this.lastExitCode;
	}

	/** Signal that terminated the child, when it exited from a signal. */
	get signal(): NodeJS.Signals | null {
		return this.lastSignal;
	}

	/** Failure recorded for this child, if any. */
	get failure(): Error | undefined {
		return this.lastFailure;
	}

	/** Raw stderr tail, redacted; safe to attach to a crash report. */
	get stderr(): string {
		return this.stderrTail;
	}

	/** Whether the Host exited (for supervision). */
	get exited(): Promise<void> {
		return this.exitPromise ?? Promise.resolve();
	}

	/** Start the child and wait for the authenticated URL. */
	async start(): Promise<IDshAgentHostReady> {
		if (this.authenticated) {
			return this.authenticated;
		}
		if (this.child) {
			return this.readyPromise;
		}
		const child = spawn(this.options.command, [...this.options.args], {
			cwd: this.options.cwd,
			env: this.options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			detached: !isWindows
		});
		this.child = child;
		this.exitPromise = new Promise<void>(resolve => { this.exitResolve = resolve; });

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => { this.consumeStdout(chunk); });
		child.stderr?.on('data', (chunk: string) => { this.consumeStderr(chunk); });
		child.once('error', error => {
			this.fail(new DshAgentHostStartError(`dsh Agent Host could not start: ${error.message}`, this.stderrTail, null));
			this.exitResolve?.();
		});
		child.once('close', (code, signal) => {
			this.child = undefined;
			this.lastExitCode = code;
			this.lastSignal = signal;
			if (!this.stopping && !this.readyUrlSeen) {
				this.fail(new DshAgentHostStartError(
					`dsh Agent Host exited before ready (code ${String(code)}, signal ${String(signal)})`,
					this.stderrTail,
					code
				));
			}
			this.exitResolve?.();
		});

		const timeout = this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const readiness = await Promise.race([
			this.readyPromise.then(ready => ({ ok: true as const, ready })),
			new Promise<{ ok: false }>(resolve => {
				timer = setTimeout(() => resolve({ ok: false }), timeout);
				(timer as { unref?: () => void }).unref?.();
			})
		]).finally(() => { if (timer) { clearTimeout(timer); } });
		if (!readiness.ok) {
			throw new DshAgentHostStartError(`dsh Agent Host did not become ready within ${timeout}ms`, this.stderrTail, null);
		}
		const authenticated = await this.exchangeCookie(readiness.ready);
		this.authenticated = authenticated;
		return authenticated;
	}

	/**
	 * Terminate the process tree synchronously. Used from process `exit` and
	 * signal handlers, where asynchronous teardown cannot run.
	 */
	killSync(): void {
		const child = this.child;
		if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
			return;
		}
		if (isWindows) {
			spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
		} else {
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {
				try { child.kill('SIGKILL'); } catch { /* already gone */ }
			}
		}
	}

	/** Stop the child and its descendant tree, escalating after the grace period. */
	async stop(): Promise<void> {
		const child = this.child;
		if (!child) {
			return;
		}
		this.stopping = true;
		const exited = this.exitPromise ?? Promise.resolve();
		const terminate = (signal: NodeJS.Signals): void => {
			if (child.exitCode !== null || child.signalCode !== null) {
				return;
			}
			if (isWindows) {
				spawn('taskkill', ['/pid', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { windowsHide: true });
			} else if (child.pid !== undefined) {
				try {
					// Negative pid targets the process group created by `detached`.
					process.kill(-child.pid, signal);
				} catch {
					child.kill(signal);
				}
			}
		};
		terminate('SIGTERM');
		if (!await exitsWithin(exited, STOP_GRACE_MS)) {
			terminate('SIGKILL');
			if (!await exitsWithin(exited, STOP_KILL_TIMEOUT_MS)) {
				throw new Error('dsh Agent Host did not exit after SIGKILL');
			}
		}
		this.child = undefined;
	}

	/** Compute the cookie from a token URL, without exposing the token to renderers. */
	private async exchangeCookie(ready: { url: string; origin: string }): Promise<IDshAgentHostReady> {
		const fetchImpl = this.options.fetch ?? fetch;
		const response = await fetchImpl(ready.url, { redirect: 'manual' });
		await response.body?.cancel();
		const headers = response.headers as Headers & { getSetCookie?: () => string[] };
		const raw = headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '';
		if (response.status !== 303 || raw.length === 0) {
			throw new DshAgentHostStartError(`dsh Agent Host authentication failed (HTTP ${response.status})`, this.stderrTail, null);
		}
		const end = raw.indexOf(';');
		const cookie = (end < 0 ? raw : raw.slice(0, end)).trim();
		if (cookie.length === 0 || cookie.length > 16 * 1024 || /[\r\n]/.test(cookie)) {
			throw new DshAgentHostStartError('dsh Agent Host returned an invalid authentication cookie', this.stderrTail, null);
		}
		return { ...ready, cookie };
	}

	private consumeStdout(chunk: string): void {
		this.stdoutTail = (this.stdoutTail + chunk).slice(-MAX_LOG_CHARS);
		this.stdoutBuffer += chunk;
		let index: number;
		while ((index = this.stdoutBuffer.indexOf('\n')) >= 0) {
			const line = this.stdoutBuffer.slice(0, index).replace(/\r$/, '');
			this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
			this.handleStdoutLine(line);
		}
	}

	private handleStdoutLine(line: string): void {
		const safe = redactDshAgentLog(line);
		if (safe.trim().length > 0) {
			this.options.onLog?.('info', safe);
		}
		if (this.readyUrlSeen || !this.readyResolve) {
			return;
		}
		const url = parseDshHostReadyLine(line);
		if (!url || !isLoopbackHttpUrl(url)) {
			return;
		}
		this.readyUrlSeen = true;
		this.readyResolve({ url, origin: new URL(url).origin, cookie: '' });
	}

	private consumeStderr(chunk: string): void {
		this.stderrTail = (this.stderrTail + chunk).slice(-MAX_LOG_CHARS);
		this.stderrBuffer += chunk;
		let index: number;
		while ((index = this.stderrBuffer.indexOf('\n')) >= 0) {
			const line = this.stderrBuffer.slice(0, index).replace(/\r$/, '');
			this.stderrBuffer = this.stderrBuffer.slice(index + 1);
			const safe = redactDshAgentLog(line);
			if (safe.trim().length > 0) {
				this.options.onLog?.('error', safe);
			}
		}
	}

	private fail(error: Error): void {
		this.lastFailure ??= error;
		this.readyReject?.(error);
		this.readyReject = undefined;
		this.readyResolve = undefined;
	}
}

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<false>(resolve => {
		timer = setTimeout(() => resolve(false), milliseconds);
		(timer as { unref?: () => void }).unref?.();
	});
	try {
		return await Promise.race([exit.then(() => true), timeout]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

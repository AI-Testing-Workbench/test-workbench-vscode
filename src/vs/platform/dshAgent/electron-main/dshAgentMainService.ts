/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { app, dialog, ipcMain, IpcMainEvent, IpcMainInvokeEvent, nativeTheme, session, Session } from 'electron';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { localize } from '../../../nls.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { ICodeWindow } from '../../window/electron-main/window.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import {
	checkDshAgentWorkspaceTrust,
	computeDshAgentRestartDelay,
	createEmptyDshAgentContext,
	DSH_AGENT_BRIDGE_PROTOCOL_VERSION,
	DSH_AGENT_DEFAULT_PROFILE,
	DSH_AGENT_ORIGIN,
	DSH_AGENT_PARTITION,
	DshAgentIpcChannel,
	DshAgentRendererChannel,
	DshAgentStatus,
	IDshAgentContext,
	IDshAgentMainService,
	IDshAgentOpenDiffRequest,
	IDshAgentOpenFileRequest,
	IDshAgentStatusInfo,
	normalizeDshAgentContext,
	resolveBridgePath,
	resolveDshAgentEnabled,
	validateOpenDiffRequest,
	validateOpenFileRequest
} from '../common/dshAgent.js';
import { IDshAgentTelemetryEvents } from '../common/dshAgentTelemetry.js';
import { IDshAgentPaths, IDshAgentWindowSettings } from '../common/dshAgentPaths.js';
import { writeDshAgentCrashReport } from '../node/dshAgentDiagnostics.js';
import {
	createDshAgentHostEnvironment,
	resolveDshAgentPaths
} from './dshAgentPaths.js';
import { DshAgentHostProcess, DshAgentHostStartError, IDshAgentHostReady } from '../node/dshAgentHost.js';
import { DSH_AGENT_DISABLED_PLUGINS, IDshAgentProfileInfo, prepareDshAgentProfile } from '../node/dshAgentProfile.js';
import { installDshAgentProtocol, IDshAgentProtocolTarget } from './dshAgentProtocol.js';
import { createProxyTarget, IDshAgentProxyTarget } from '../node/dshAgentProxy.js';
import { DshAgentWindow } from './dshAgentWindow.js';


const MAX_RESTARTS = 3;
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications']);

/** Served by the protocol handler until the Host reports ready. */
const STARTING_MESSAGE = localize('dshAgent.starting', "Starting dsh Agent…");

/**
 * Owns the dedicated dsh Agent window, its isolated Host process, the
 * application protocol, and the bounded IDE bridge.
 */
export class DshAgentMainService extends Disposable implements IDshAgentMainService, IDshAgentProtocolTarget {

	private window: DshAgentWindow | undefined;
	private host: DshAgentHostProcess | undefined;
	private hostReady: IDshAgentHostReady | undefined;
	private proxyTarget: IDshAgentProxyTarget | undefined;
	private session: Session | undefined;
	private protocolError: string | undefined;
	private protocolRegistration: { dispose(): void } | undefined;
	private webRequestInstalled = false;
	private startPromise: Promise<void> | undefined;
	private stopPromise: Promise<void> | undefined;
	private status: DshAgentStatus = DshAgentStatus.Stopped;
	private restartCount = 0;
	private lastHostExit: { readonly exitCode: number | null; readonly signal: NodeJS.Signals | null; readonly stderr: string } | undefined;
	private safeMode = false;
	private context: IDshAgentContext;
	private lastError: string | undefined;
	private profileInfo: IDshAgentProfileInfo | undefined;
	private hostWorkspace: string | undefined;
	private quitting = false;
	private windowOpenedAt: number | undefined;
	private readonly ipcHandlers: string[] = [];

	constructor(
		private readonly logService: ILogService,
		private readonly windowsMainService: IWindowsMainService,
		private readonly environmentMainService: IEnvironmentMainService,
		private readonly configurationService: IConfigurationService,
		private readonly lifecycleMainService: ILifecycleMainService,
		private readonly productService: IProductService,
		private readonly telemetryService: ITelemetryService
	) {
		super();
		this.context = createEmptyDshAgentContext(
			nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
			app.getLocale()
		);

		this._register(this.lifecycleMainService.onWillShutdown(event => {
			this.quitting = true;
			event.join('dshAgent', this.shutdown());
		}));
		const beforeQuit = () => { this.quitting = true; };
		app.on('before-quit', beforeQuit);
		this._register(toDisposable(() => app.removeListener('before-quit', beforeQuit)));

		const themeUpdated = () => {
			this.context = { ...this.context, theme: this.effectiveTheme() };
			this.window?.sendTheme(nativeTheme.shouldUseDarkColors);
		};
		nativeTheme.on('updated', themeUpdated);
		this._register(toDisposable(() => nativeTheme.removeListener('updated', themeUpdated)));

		this.registerIpcHandlers();
		this.installAbruptExitGuards();
	}

	// #region IDshAgentProtocolTarget

	getTarget(): IDshAgentProxyTarget | undefined {
		return this.proxyTarget;
	}

	getError(): string | undefined {
		return this.protocolError;
	}

	// #endregion

	/** Whether the window is available under the current policy. */
	isEnabled(): boolean {
		return this.resolveEnabled();
	}

	async openWindow(): Promise<void> {
		const requireTrustedWorkspace = this.requiresTrustedWorkspace();
		const decision = checkDshAgentWorkspaceTrust({
			enabled: this.resolveEnabled(),
			requireTrustedWorkspace,
			// Before the workbench publishes its first context snapshot the trust
			// state is unknown; fail closed when trust is required.
			trusted: this.context.revision === 0 ? !requireTrustedWorkspace : this.context.trusted,
			hasWorkspaceFolder: this.context.workspaceFolders.length > 0
		});
		if (decision === 'disabled') {
			throw new Error(localize('dshAgent.disabled', "The dsh Agent window is disabled by policy."));
		}
		if (decision === 'untrusted') {
			throw new Error(localize('dshAgent.untrusted', "Open the folder and trust it before starting dsh Agent."));
		}
		const currentWorkspace = this.context.workspaceFolders[0];
		const workspaceChanged = this.hostReady !== undefined && this.hostWorkspace !== currentWorkspace;
		const window = this.ensureWindow();
		window.show();
		if (this.hostReady && !workspaceChanged) {
			if (!window.hasLoaded()) {
				await window.load();
			}
			return;
		}
		if (workspaceChanged) {
			// v1 hosts one workspace per session; switching folders starts a fresh
			// Host so tools and relative paths use the new root.
			await this.stopHost();
		}
		await window.load();
		try {
			const startedAt = Date.now();
			await this.startHost();
			await this.reloadWindow();
			this.windowOpenedAt ??= startedAt;
			this.telemetryService.publicLog('dshAgentWindowOpened', {
				coldStartMs: Date.now() - startedAt,
				restartCount: this.restartCount,
				safeMode: this.safeMode
			} satisfies IDshAgentTelemetryEvents['dshAgentWindowOpened']);
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	async closeWindow(): Promise<void> {
		this.window?.hide();
	}

	async getStatus(): Promise<IDshAgentStatusInfo> {
		return this.statusInfo();
	}

	async updateContext(value: unknown): Promise<void> {
		const normalized = normalizeDshAgentContext(value, this.context);
		const next: IDshAgentContext = {
			...normalized,
			trusted: normalized.workspaceFolders.length === 0 ? true : normalized.trusted
		};
		const dark = next.theme === 'dark' || next.theme === 'hc';
		const themeChanged = dark !== (this.context.theme === 'dark' || this.context.theme === 'hc');
		this.context = next;
		this.logService.trace(`[dshAgent] context update: revision=${next.revision} folders=${next.workspaceFolders.length} trusted=${next.trusted}`);
		if (themeChanged) {
			this.window?.sendTheme(dark);
		}
		this.window?.sendContext(next);
	}

	/**
	 * Electron quit paths are graceful, but SIGTERM from a supervisor or a
	 * process-level exit skips them. Kill the Host tree synchronously so an
	 * abnormal shutdown never leaves an orphaned dsh process.
	 */
	private installAbruptExitGuards(): void {
		// These guards intentionally live for the whole process. Disposing them
		// during shutdown can happen before Electron's final quit hooks, which is
		// exactly when the Host would otherwise be orphaned.
		process.on('exit', () => {
			this.host?.killSync();
		});
		const willQuit = () => { this.host?.killSync(); };
		app.on('will-quit', willQuit);

		const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
		for (const signal of signals) {
			process.on(signal, () => {
				this.host?.killSync();
				// Restore the default disposition and re-deliver so the process
				// exits with the conventional status.
				process.removeAllListeners(signal);
				process.kill(process.pid, signal);
			});
		}
	}

	// #region Window and protocol

	private ensureWindow(): DshAgentWindow {
		if (this.window && !this.window.isDestroyed()) {
			return this.window;
		}
		const session = this.ensureSession();
		this.window = this._register(new DshAgentWindow({
			preload: FileAccess.asFileUri('vs/platform/dshAgent/electron-browser/dshAgentPreload.js').fsPath,
			session,
			hostOrigin: this.proxyTarget?.origin,
			locale: this.context.locale,
			isQuitting: () => this.quitting,
			logService: this.logService,
			onClosedByUser: () => {
				if (this.windowOpenedAt !== undefined) {
					this.telemetryService.publicLog('dshAgentWindowClosed', { uptimeMs: Date.now() - this.windowOpenedAt });
				}
			},
			onRendererGone: reason => {
				this.logService.error(`[dshAgent] renderer gone: ${reason}`);
				void this.writeCrash('renderer', `renderer gone: ${reason}`);
			}
		}));
		this.window.sendTheme(this.context.theme === 'dark' || this.context.theme === 'hc');
		return this.window;
	}

	private ensureSession(): Session {
		if (this.session) {
			return this.session;
		}
		const partitionSession = session.fromPartition(DSH_AGENT_PARTITION);
		this.session = partitionSession;
		partitionSession.setPermissionRequestHandler((_webContents, permission, callback) => {
			callback(PERMISSIONS.has(permission));
		});
		partitionSession.setPermissionCheckHandler((_webContents, permission) => PERMISSIONS.has(permission));
		this.protocolRegistration = installDshAgentProtocol(this, partitionSession);
		this.installWebSocketFence(partitionSession);
		return partitionSession;
	}

	private installWebSocketFence(session: Session): void {
		if (this.webRequestInstalled) {
			return;
		}
		this.webRequestInstalled = true;
		session.webRequest.onBeforeSendHeaders(
			{ urls: ['ws://*/*', 'wss://*/*'] },
			(details, callback) => {
				const target = this.hostReady;
				const window = this.window;
				if (!target || !window || window.isDestroyed() || details.webContentsId !== window.webContentsId()) {
					callback({});
					return;
				}
				let requested: URL;
				try {
					requested = new URL(details.url);
				} catch {
					callback({ cancel: true });
					return;
				}
				const host = new URL(target.origin);
				const expectedProtocol = host.protocol === 'https:' ? 'wss:' : 'ws:';
				if (requested.host !== host.host || requested.protocol !== expectedProtocol) {
					callback({ cancel: true });
					return;
				}
				const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]));
				if (headers.origin !== DSH_AGENT_ORIGIN) {
					callback({ cancel: true });
					return;
				}
				callback({
					requestHeaders: {
						...headers,
						origin: host.origin,
						cookie: target.cookie,
						'sec-fetch-site': 'same-origin'
					}
				});
			}
		);
	}

	private async reloadWindow(): Promise<void> {
		const window = this.window;
		if (!window || window.isDestroyed()) {
			return;
		}
		await window.load();
		window.sendContext(this.context);
	}

	// #endregion

	// #region Host lifecycle

	private async startHost(): Promise<void> {
		if (this.hostReady) {
			return;
		}
		if (this.startPromise) {
			return this.startPromise;
		}
		this.startPromise = this.startHostOnce().finally(() => { this.startPromise = undefined; });
		return this.startPromise;
	}

	private async startHostOnce(): Promise<void> {
		const settings = this.settings();
		const paths = resolveDshAgentPaths(this.environmentMainService, settings);
		const workspace = this.context.workspaceFolders[0];
		const effectiveHome = this.safeMode ? `${paths.dshHome}-safe` : paths.dshHome;
		const homePaths: IDshAgentPaths = { ...paths, dshHome: effectiveHome };
		const prepared = await prepareDshAgentProfile(homePaths, this.logService);
		this.profileInfo = prepared.info;

		const command = this.resolveHostCommand(paths);
		this.status = DshAgentStatus.Starting;
		this.protocolError = STARTING_MESSAGE;
		const host = new DshAgentHostProcess({
			command: command.command,
			args: [...command.args, settings.profile || DSH_AGENT_DEFAULT_PROFILE, '--no-open', '--host', '127.0.0.1', '--port', '0'],
			cwd: workspace ?? app.getPath('home'),
			env: createDshAgentHostEnvironment(homePaths, process.env),
			onLog: (level, message) => {
				if (level === 'error') {
					this.logService.error(`[dshAgent:host] ${message}`);
				} else {
					this.logService.trace(`[dshAgent:host] ${message}`);
				}
			}
		});
		this.host = host;
		try {
			const ready = await host.start();
			if (this.host !== host) {
				await host.stop();
				return;
			}
			this.hostReady = ready;
			this.proxyTarget = createProxyTarget(ready.origin, ready.cookie);
			this.protocolError = undefined;
			this.hostWorkspace = workspace;
			this.status = this.safeMode ? DshAgentStatus.SafeMode : DshAgentStatus.Ready;
			this.lastError = undefined;
			this.watchHost(host);
		} catch (error) {
			await host.stop().catch(() => undefined);
			if (this.host === host) {
				this.host = undefined;
			}
			throw error;
		}
	}

	private watchHost(host: DshAgentHostProcess): void {
		void host.exited.then(() => {
			if (this.host !== host || this.quitting) {
				return;
			}
			this.hostReady = undefined;
			this.proxyTarget = undefined;
			this.protocolError = localize('dshAgent.hostStopped', "dsh Agent Host stopped. Restarting…");
			this.lastHostExit = { exitCode: host.exitCode, signal: host.signal, stderr: host.stderr };
			this.host = undefined;
			this.status = DshAgentStatus.Restarting;
			this.lastError = host.failure?.message ?? `Host exited (code ${String(host.exitCode)})`;
			this.logService.error(`[dshAgent] Host exited unexpectedly: ${this.lastError}`);
			void this.writeCrash('host-exit', this.lastError);
			this.telemetryService.publicLog('dshAgentHostFailed', {
				exitCode: host.exitCode ?? undefined,
				restartCount: this.restartCount,
				errorCode: host.failure instanceof DshAgentHostStartError ? 'start-failed' : 'unexpected-exit'
			});
			void this.handleHostExit();
		});
	}

	private async handleHostExit(): Promise<void> {
		const settings = this.settings();
		if (!this.quitting && settings.autoRestart && this.restartCount < MAX_RESTARTS) {
			const attempt = this.restartCount++;
			const delay = computeDshAgentRestartDelay(attempt);
			this.telemetryService.publicLog('dshAgentHostRestarted', { attempt, delayMs: delay });
			await delayFor(delay);
			if (this.quitting) {
				return;
			}
			try {
				await this.startHost();
				await this.reloadWindow();
				return;
			} catch (error) {
				this.fail(error);
				return;
			}
		}
		if (!this.safeMode && !this.quitting) {
			this.safeMode = true;
			this.logService.warn('[dshAgent] entering safe mode: user plugins are not loaded');
			try {
				await this.startHost();
				await this.reloadWindow();
				return;
			} catch (error) {
				this.fail(error);
				return;
			}
		}
		this.fail(new Error(this.lastError ?? 'dsh Agent Host is unavailable'));
	}

	private async stopHost(): Promise<void> {
		const host = this.host;
		this.logService.info(`[dshAgent] stopHost: pid=${host?.pid ?? 'none'}`);
		this.host = undefined;
		this.hostReady = undefined;
		this.proxyTarget = undefined;
		if (!host) {
			return;
		}
		try {
			await host.stop();
		} catch (error) {
			this.logService.error('[dshAgent] could not stop the Host cleanly', error);
		}
	}

	private shutdown(): Promise<void> {
		this.stopPromise ??= (async () => {
			this.logService.info('[dshAgent] shutdown requested');
			this.quitting = true;
			await this.stopHost();
			this.protocolRegistration?.dispose();
			this.session = undefined;
			this.window = undefined;
		})();
		return this.stopPromise;
	}

	private resolveHostCommand(paths: IDshAgentPaths): { command: string; args: string[] } {
		if (paths.dshEntry) {
			return { command: paths.node, args: [paths.dshEntry] };
		}
		if (paths.dshCommand) {
			// Windows npm shims are `.cmd` files, which Node cannot spawn without
			// a command interpreter.
			if (/\\.(cmd|bat)$/i.test(paths.dshCommand)) {
				return { command: process.env['ComSpec'] ?? 'cmd.exe', args: ['/d', '/s', '/c', paths.dshCommand] };
			}
			return { command: paths.dshCommand, args: [] };
		}
		// A staged Node without a staged dsh package is a broken installation.
		if (paths.runtimeVersion) {
			throw new Error(localize('dshAgent.runtimeIncomplete', "The bundled dsh runtime is incomplete. Reinstall the application."));
		}
		throw new Error(localize('dshAgent.runtimeMissing', "dsh was not found. Install Node 22.22.1 and dsh, or run scripts/dsh-agent/prepare-runtime.mjs."));
	}

	// #endregion

	// #region Bridge

	private registerIpcHandlers(): void {
		this.handle(DshAgentIpcChannel.Context, event => {
			this.assertBridgeSender(event);
			return this.context;
		});
		this.handle(DshAgentIpcChannel.OpenFile, (event, value) => {
			this.assertBridgeSender(event);
			const request = validateOpenFileRequest(value);
			if (!request) {
				this.rejectBridge('openFile', 'invalid-request');
				return false;
			}
			return this.openFileInIde(request);
		});
		this.handle(DshAgentIpcChannel.OpenDiff, (event, value) => {
			this.assertBridgeSender(event);
			const request = validateOpenDiffRequest(value);
			if (!request) {
				this.rejectBridge('openDiff', 'invalid-request');
				return false;
			}
			return this.openDiffInIde(request);
		});
		this.handle(DshAgentIpcChannel.RevealInExplorer, (event, value) => {
			this.assertBridgeSender(event);
			const path = resolveBridgePath(value, this.context.workspaceFolders);
			if (!path) {
				this.rejectBridge('reveal', 'outside-workspace');
				return false;
			}
			const ide = this.ideWindow();
			if (!ide) {
				return false;
			}
			ide.send('vscode:dshAgentRevealInExplorer', path);
			return true;
		});
		this.handle(DshAgentIpcChannel.PickDirectory, async event => {
			this.assertBridgeSender(event);
			// Always ask for a folder. Returning the current IDE root here made the
			// dsh "add workspace" button a silent no-op once that workspace existed;
			// the root is only the dialog's starting point.
			const root = this.context.workspaceFolders[0];
			const options: Electron.OpenDialogOptions = {
				properties: ['openDirectory', 'createDirectory'],
				...(root ? { defaultPath: root } : {})
			};
			this.logService.info('[dshAgent] opening native directory picker');
			const window = this.window;
			const result = window && !window.isDestroyed()
				? await dialog.showOpenDialog(window.browserWindow, options)
				: await dialog.showOpenDialog(options);
			return result.canceled ? null : result.filePaths[0] ?? null;
		});
		this.handle(DshAgentIpcChannel.Status, event => {
			this.assertBridgeSender(event);
			return { ...this.statusInfo(), protocolVersion: DSH_AGENT_BRIDGE_PROTOCOL_VERSION };
		});
		this.handle(DshAgentIpcChannel.Ready, event => {
			this.assertBridgeSender(event);
			return true;
		});
		ipcMain.on('dsh-agent:bridge:host-origin', (event: IpcMainEvent) => {
			event.returnValue = this.isBridgeSender(event) ? this.proxyTarget?.origin : undefined;
		});
		this.ipcHandlers.push('dsh-agent:bridge:host-origin');
	}

	private handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
		ipcMain.handle(channel, handler);
		this.ipcHandlers.push(channel);
	}

	private assertBridgeSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
		if (!this.isBridgeSender(event)) {
			this.rejectBridge('ipc', 'unowned-sender');
			throw new Error('dsh Agent bridge rejected an unowned sender');
		}
	}

	private isBridgeSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
		const window = this.window;
		if (!window || window.isDestroyed() || event.sender !== window.browserWindow.webContents) {
			return false;
		}
		const frame = event.senderFrame;
		if (!frame || frame !== event.sender.mainFrame) {
			return false;
		}
		return frame.url.startsWith(`${DSH_AGENT_ORIGIN}/`) || frame.url === DSH_AGENT_ORIGIN;
	}

	private openFileInIde(request: IDshAgentOpenFileRequest): boolean {
		const path = resolveBridgePath(request.path, this.context.workspaceFolders);
		if (!path) {
			this.rejectBridge('openFile', 'outside-workspace');
			return false;
		}
		const ide = this.ideWindow();
		if (!ide) {
			this.rejectBridge('openFile', 'no-ide-window');
			return false;
		}
		ide.send(DshAgentRendererChannel.OpenFile, { ...request, path });
		if (request.preserveFocus !== true) {
			ide.focus();
		}
		return true;
	}

	private openDiffInIde(request: IDshAgentOpenDiffRequest): boolean {
		const path = resolveBridgePath(request.path, this.context.workspaceFolders);
		const originalPath = request.originalPath === undefined
			? undefined
			: resolveBridgePath(request.originalPath, this.context.workspaceFolders);
		if (!path || (request.originalPath !== undefined && !originalPath)) {
			this.rejectBridge('openDiff', 'outside-workspace');
			return false;
		}
		const ide = this.ideWindow();
		if (!ide) {
			this.rejectBridge('openDiff', 'no-ide-window');
			return false;
		}
		ide.send(DshAgentRendererChannel.OpenDiff, { ...request, path, originalPath });
		if (request.preserveFocus !== true) {
			ide.focus();
		}
		return true;
	}

	private ideWindow(): ICodeWindow | undefined {
		const active = this.windowsMainService.getLastActiveWindow()
			?? this.windowsMainService.getWindows().find(candidate => candidate.win !== null);
		return active && active.win && !active.win.isDestroyed() ? active : undefined;
	}

	private rejectBridge(operation: string, reason: string): void {
		this.telemetryService.publicLog('dshAgentBridgeRejected', { operation, reason });
		this.logService.warn(`[dshAgent] bridge rejected ${operation}: ${reason}`);
	}

	// #endregion

	// #region Status and diagnostics

	private statusInfo(): IDshAgentStatusInfo {
		return {
			status: this.status,
			enabled: this.resolveEnabled(),
			restartCount: this.restartCount,
			safeMode: this.safeMode,
			origin: this.proxyTarget?.origin,
			lastError: this.lastError
		};
	}

	private fail(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.lastError = message;
		this.status = DshAgentStatus.Failed;
		this.protocolError = message;
		this.logService.error('[dshAgent] Host failed', error);
		void this.writeCrash('host-start', message);
		const window = this.ensureWindow();
		window.show();
		void window.load();
	}

	private async writeCrash(source: 'host-start' | 'host-exit' | 'renderer', message: string): Promise<void> {
		try {
			const settings = this.settings();
			const paths = resolveDshAgentPaths(this.environmentMainService, settings);
			await writeDshAgentCrashReport(paths.logDirectory, {
				source,
				message,
				exitCode: this.lastHostExit?.exitCode ?? null,
				signal: this.lastHostExit?.signal ?? null,
				stderrTail: this.lastHostExit?.stderr ?? '',
				restartCount: this.restartCount,
				safeMode: this.safeMode,
				hostWorkspace: this.hostWorkspace,
				profile: this.profileInfo,
				runtimeVersion: paths.runtimeVersion,
				versions: {
					app: app.getVersion(),
					electron: process.versions.electron,
					node: process.versions.node,
					chrome: process.versions.chrome
				},
				time: new Date().toISOString()
			});
		} catch (error) {
			this.logService.error('[dshAgent] could not write crash report', error);
		}
	}

	private effectiveTheme(): IDshAgentContext['theme'] {
		if (nativeTheme.shouldUseHighContrastColors) {
			return nativeTheme.shouldUseDarkColors ? 'hc' : 'hc-light';
		}
		return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
	}

	private settings(): IDshAgentWindowSettings {
		const configured = this.configurationService.getValue<Partial<IDshAgentWindowSettings>>('dsh.agentWindow') ?? {};
		return {
			enabled: configured.enabled !== false,
			requireTrustedWorkspace: configured.requireTrustedWorkspace !== false,
			nodePath: typeof configured.nodePath === 'string' && configured.nodePath.length > 0 ? configured.nodePath : undefined,
			dshHome: typeof configured.dshHome === 'string' && configured.dshHome.length > 0 ? configured.dshHome : undefined,
			dshEntry: typeof configured.dshEntry === 'string' && configured.dshEntry.length > 0 ? configured.dshEntry : undefined,
			profile: typeof configured.profile === 'string' && configured.profile.length > 0 ? configured.profile : DSH_AGENT_DEFAULT_PROFILE,
			autoRestart: configured.autoRestart !== false
		};
	}

	private resolveEnabled(): boolean {
		const product = this.productService.dshAgent;
		return resolveDshAgentEnabled({
			productEnabled: product?.enabled,
			killSwitch: product?.killSwitch,
			environmentDisabled: process.env['TSCODE_DSH_AGENT_DISABLED'] === '1',
			settingEnabled: this.settings().enabled
		});
	}

	private requiresTrustedWorkspace(): boolean {
		return this.settings().requireTrustedWorkspace;
	}

	// #endregion

	/** Test hook: the disabled-plugin allowlist enforced on the managed profile. */
	get disabledPlugins(): readonly string[] {
		return DSH_AGENT_DISABLED_PLUGINS;
	}

	override dispose(): void {
		for (const channel of this.ipcHandlers) {
			try {
				ipcMain.removeHandler(channel);
				ipcMain.removeAllListeners(channel);
			} catch {
				// A handler may have been removed by a reloaded service.
			}
		}
		this.ipcHandlers.length = 0;
		super.dispose();
	}
}

function delayFor(milliseconds: number): Promise<void> {
	return new Promise(resolve => {
		const timer = setTimeout(resolve, milliseconds);
		(timer as { unref?: () => void }).unref?.();
	});
}

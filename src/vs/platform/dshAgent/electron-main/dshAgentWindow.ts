/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { BrowserWindow, nativeTheme, Session, shell } from 'electron';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../log/common/log.js';
import { DSH_AGENT_ORIGIN, IDshAgentContext } from '../common/dshAgent.js';

/** Options for the dedicated Agent window. */
export interface IDshAgentWindowOptions {
	readonly preload: string;
	readonly session: Session;
	readonly hostOrigin: string | undefined;
	readonly locale: string;
	readonly isQuitting: () => boolean;
	readonly logService: ILogService;
	readonly onClosedByUser: () => void;
	readonly onRendererGone: (reason: string) => void;
}

/**
 * One BrowserWindow that hosts the dsh web frontend.
 * The window is a singleton owned by {@link DshAgentMainService}; closing it
 * hides it so an in-flight Agent turn is not interrupted.
 */
export class DshAgentWindow extends Disposable {

	readonly browserWindow: BrowserWindow;
	private debuggerAttached = false;
	private dark = nativeTheme.shouldUseDarkColors;

	constructor(private readonly options: IDshAgentWindowOptions) {
		super();
		const dark = nativeTheme.shouldUseDarkColors;
		this.browserWindow = new BrowserWindow({
			width: 1280,
			height: 860,
			minWidth: 720,
			minHeight: 520,
			show: false,
			title: 'dsh Agent',
			backgroundColor: dark ? '#1b1b1c' : '#f9fafb',
			autoHideMenuBar: true,
			webPreferences: {
				preload: options.preload,
				session: options.session,
				nodeIntegration: false,
				nodeIntegrationInWorker: false,
				nodeIntegrationInSubFrames: false,
				contextIsolation: true,
				sandbox: true,
				webSecurity: true,
				allowRunningInsecureContent: false,
				experimentalFeatures: false,
				webviewTag: false,
				spellcheck: false,
				navigateOnDragDrop: false,
				safeDialogs: true,
				autoplayPolicy: 'user-gesture-required',
				additionalArguments: [
					`--tscode-dsh-host-origin=${options.hostOrigin ?? ''}`,
					`--tscode-locale=${options.locale}`
				]
			}
		});

		this._register({
			dispose: () => {
				if (this.browserWindow.isDestroyed()) {
					return;
				}
				if (this.debuggerAttached) {
					try { this.browserWindow.webContents.debugger.detach(); } catch { /* already detached */ }
				}
				this.browserWindow.destroy();
			}
		});

		const webContents = this.browserWindow.webContents;
		this.browserWindow.on('close', event => {
			if (!options.isQuitting() && !this.browserWindow.isDestroyed()) {
				event.preventDefault();
				this.browserWindow.hide();
				options.onClosedByUser();
			}
		});
		this.browserWindow.on('closed', () => {
			// Nothing else owns the window after destruction.
		});

		webContents.setWindowOpenHandler(({ url }) => {
			this.openExternal(url);
			return { action: 'deny' };
		});
		webContents.on('will-attach-webview', event => {
			event.preventDefault();
		});
		const blockNavigation = (event: Electron.Event, url: string): void => {
			if (url.startsWith(DSH_AGENT_ORIGIN)) {
				return;
			}
			event.preventDefault();
			this.openExternal(url);
		};
		webContents.on('will-navigate', blockNavigation);
		webContents.on('will-redirect', blockNavigation);
		webContents.on('did-finish-load', () => {
			// A reload resets DevTools emulation.
			this.applyEmulatedTheme(this.dark);
		});
		webContents.on('render-process-gone', (_event, details) => {
			options.onRendererGone(details.reason);
		});
		webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			if (!isMainFrame || validatedURL.startsWith(DSH_AGENT_ORIGIN) === false) {
				return;
			}
			options.logService.error(`[dshAgent] window failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
		});
	}

	/** Show the window, restoring a minimized window first. */
	show(): void {
		if (this.browserWindow.isDestroyed()) {
			return;
		}
		if (this.browserWindow.isMinimized()) {
			this.browserWindow.restore();
		}
		this.browserWindow.show();
		this.browserWindow.focus();
	}

	/** Hide without destroying. */
	hide(): void {
		if (!this.browserWindow.isDestroyed()) {
			this.browserWindow.hide();
		}
	}

	/** Load the application origin; the protocol handler decides whether the Host is ready. */
	async load(): Promise<void> {
		if (this.browserWindow.isDestroyed()) {
			return;
		}
		try {
			await this.browserWindow.loadURL(`${DSH_AGENT_ORIGIN}/`);
		} catch (error) {
			this.options.logService.error('[dshAgent] could not load the Agent application', error);
		}
	}

	/** Deliver an IDE context snapshot to the page. */
	sendContext(context: IDshAgentContext): void {
		this.send('dsh-agent:bridge:context-changed', context);
	}

	/** Deliver the effective dark/light mode. */
	sendTheme(dark: boolean): void {
		this.applyEmulatedTheme(dark);
		this.send('dsh-agent:bridge:theme-changed', dark);
	}

	/**
	 * Make `prefers-color-scheme` follow the IDE without changing the
	 * application-wide `nativeTheme`, which also drives VS Code chrome.
	 */
	private applyEmulatedTheme(dark: boolean): void {
		this.dark = dark;
		const webContents = this.browserWindow.webContents;
		if (webContents.isDestroyed()) {
			return;
		}
		try {
			if (!this.debuggerAttached) {
				webContents.debugger.attach('1.3');
				this.debuggerAttached = true;
			}
			void webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
				features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]
			}).catch(error => {
				this.options.logService.trace(`[dshAgent] could not emulate theme: ${error instanceof Error ? error.message : String(error)}`);
			});
		} catch (error) {
			// DevTools may already be attached by the user; the page keeps the OS
			// scheme and the context event still tells plugins the IDE theme.
			this.options.logService.trace(`[dshAgent] theme emulation unavailable: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	isDestroyed(): boolean {
		return this.browserWindow.isDestroyed();
	}

	/** Whether a document has been requested; a new window has an empty URL. */
	hasLoaded(): boolean {
		return !this.browserWindow.isDestroyed() && this.browserWindow.webContents.getURL().length > 0;
	}

	webContentsId(): number {
		return this.browserWindow.webContents.id;
	}

	private send(channel: string, ...args: unknown[]): void {
		if (!this.browserWindow.isDestroyed()) {
			this.browserWindow.webContents.send(channel, ...args);
		}
	}

	private openExternal(value: string): void {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			return;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') {
			return;
		}
		void shell.openExternal(url.toString()).catch(error => {
			this.options.logService.warn(`[dshAgent] could not open external URL: ${error instanceof Error ? error.message : String(error)}`);
		});
	}
}

/** Convenience for tests: render a file URI from a validated absolute path. */
export function fileUriFromPath(path: string): URI {
	return URI.file(path);
}

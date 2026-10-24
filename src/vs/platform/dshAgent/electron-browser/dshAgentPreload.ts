/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

// test-workbench_change - new file

/**
 * Preload for the dsh Agent BrowserWindow.
 *
 * The window is sandboxed and context-isolated. This script exposes a bounded
 * IDE bridge and publishes the Host transport base URL before the dsh client
 * boots, so the WebSocket mux reaches the loopback Host through the session's
 * header fence instead of the custom protocol origin.
 */
(function () {

	const { contextBridge, ipcRenderer, webFrame } = require('electron');

	type DshAgentSelection = {
		readonly path: string;
		readonly startLine: number;
		readonly startColumn: number;
		readonly endLine: number;
		readonly endColumn: number;
		readonly text: string;
	};
	type DshAgentContext = {
		readonly revision: number;
		readonly trusted: boolean;
		readonly workspaceFolders: readonly string[];
		readonly activeFile?: string;
		readonly languageId?: string;
		readonly selection?: DshAgentSelection;
		readonly theme: string;
		readonly locale: string;
	};
	type OpenFileRequest = { path: string; line?: number; column?: number; preserveFocus?: boolean };
	type OpenDiffRequest = { path: string; originalPath?: string; line?: number; preserveFocus?: boolean };

	const PROTOCOL_VERSION = 1;
	const ORIGIN_ARGUMENT = '--tscode-dsh-host-origin=';
	const ORIGIN_CHANNEL = 'dsh-agent:bridge:host-origin';
	const LOCALE_ARGUMENT = '--tscode-locale=';

	function readArgument(prefix: string): string | undefined {
		for (const argument of process.argv) {
			if (argument.startsWith(prefix)) {
				const value = argument.slice(prefix.length);
				return value.length > 0 ? value : undefined;
			}
		}
		return undefined;
	}

	// The Host port is chosen by the Host on every start, so the main process is
	// asked synchronously: the preload must publish the transport before the first
	// client module evaluates.
	function resolveHostOrigin(): string | undefined {
		try {
			const origin: unknown = ipcRenderer.sendSync(ORIGIN_CHANNEL);
			if (typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin)) {
				return origin;
			}
		} catch (error) {
			console.error('dsh Agent: could not read the Host origin', error);
		}
		return readArgument(ORIGIN_ARGUMENT);
	}

	const hostOrigin = resolveHostOrigin();
	const locale = readArgument(LOCALE_ARGUMENT);
	let isMainFrame = true;
	try {
		isMainFrame = window.top === window;
	} catch {
		isMainFrame = false;
	}
	const isAgentDocument = location.protocol === 'dsh-agent:' && location.hostname === 'app' && isMainFrame;

	// The dsh client resolves its WebSocket mux against this base. `ownsHost` tells
	// the client that the Host lifecycle belongs to the embedding application.
	if (hostOrigin !== undefined && /^https?:\/\/[^/]+$/.test(hostOrigin)) {
		try {
			contextBridge.exposeInMainWorld('__DSH_TRANSPORT__', { ownsHost: true, streamBaseUrl: hostOrigin });
		} catch (error) {
			console.error('dsh Agent: could not publish transport', error);
		}
	}

	// Match the IDE's display language where the dsh client reads `navigator.language`.
	// The override is best-effort; a read-only property never blocks boot.
	if (locale !== undefined && /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})?$/.test(locale)) {
		try {
			webFrame.executeJavaScript(
				`(() => { try { Object.defineProperty(navigator, 'language', { configurable: true, get: () => ${JSON.stringify(locale)} }); } catch {} })()`
			);
		} catch (error) {
			console.error('dsh Agent: could not apply locale', error);
		}
	}

	if (!isAgentDocument) {
		return;
	}

	function isString(value: unknown, maxLength: number): value is string {
		return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\r\n\0]/.test(value);
	}

	function sanitizeOpenFile(value: unknown): OpenFileRequest | undefined {
		if (typeof value !== 'object' || value === null) {
			return undefined;
		}
		const candidate = value as Record<string, unknown>;
		if (!isString(candidate.path, 4096)) {
			return undefined;
		}
		const line = typeof candidate.line === 'number' && Number.isSafeInteger(candidate.line) && candidate.line > 0 ? candidate.line : undefined;
		const column = typeof candidate.column === 'number' && Number.isSafeInteger(candidate.column) && candidate.column > 0 ? candidate.column : undefined;
		return { path: candidate.path, line, column, preserveFocus: candidate.preserveFocus === true };
	}

	function sanitizeOpenDiff(value: unknown): OpenDiffRequest | undefined {
		const request = sanitizeOpenFile(value);
		if (!request) {
			return undefined;
		}
		const candidate = value as Record<string, unknown>;
		if (candidate.originalPath !== undefined && !isString(candidate.originalPath, 4096)) {
			return undefined;
		}
		return { ...request, originalPath: candidate.originalPath as string | undefined };
	}

	const contextListeners = new Set<(context: DshAgentContext) => void>();
	const themeListeners = new Set<(dark: boolean) => void>();

	ipcRenderer.on('dsh-agent:bridge:context-changed', (_event: unknown, context: DshAgentContext) => {
		for (const listener of contextListeners) {
			try { listener(context); } catch (error) { console.error('dsh Agent: context listener failed', error); }
		}
	});
	ipcRenderer.on('dsh-agent:bridge:theme-changed', (_event: unknown, dark: boolean) => {
		for (const listener of themeListeners) {
			try { listener(dark === true); } catch (error) { console.error('dsh Agent: theme listener failed', error); }
		}
	});

	function addListener<T>(set: Set<T>, listener: T): () => void {
		set.add(listener);
		return () => { set.delete(listener); };
	}

	// dsh's native directory picker asks the embedding shell first. Return the
	// current IDE workspace root so a single-root session starts in place.
	contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', {
		pick: () => ipcRenderer.invoke('dsh-agent:bridge:pick-directory')
	});

	contextBridge.exposeInMainWorld('tscodeAgent', {
		protocolVersion: PROTOCOL_VERSION,
		getContext: (): Promise<DshAgentContext> => ipcRenderer.invoke('dsh-agent:bridge:context'),
		onContextChanged: (listener: (context: DshAgentContext) => void) => addListener(contextListeners, listener),
		getStatus: () => ipcRenderer.invoke('dsh-agent:bridge:status'),
		openFile: (value: OpenFileRequest) => {
			const request = sanitizeOpenFile(value);
			return request ? ipcRenderer.invoke('dsh-agent:bridge:open-file', request) : Promise.resolve(false);
		},
		openDiff: (value: OpenDiffRequest) => {
			const request = sanitizeOpenDiff(value);
			return request ? ipcRenderer.invoke('dsh-agent:bridge:open-diff', request) : Promise.resolve(false);
		},
		revealInExplorer: (path: string) => isString(path, 4096) ? ipcRenderer.invoke('dsh-agent:bridge:reveal', path) : Promise.resolve(false),
		onThemeChanged: (listener: (dark: boolean) => void) => addListener(themeListeners, listener),
		reportReady: () => ipcRenderer.invoke('dsh-agent:bridge:ready')
	});

	// Fallback integration: dsh renders workspace file links as buttons whose title
	// carries the path. Without the packaged dsh client plugin, route a plain click
	// to the IDE. The plugin is preferred because it can fall back to dsh's own
	// sidebar after a host rejection.
	if (typeof window.addEventListener === 'function') {
		window.addEventListener('click', event => {
			if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}
			const button = target.closest('button');
			if (!button) {
				return;
			}
			const className = button.getAttribute('class') ?? '';
			if (!/(^|\s)_?fileLink_?\w*/.test(className)) {
				return;
			}
			const path = button.getAttribute('title') ?? button.textContent ?? '';
			const request = sanitizeOpenFile({ path: path.trim() });
			if (!request) {
				return;
			}
			event.preventDefault();
			ipcRenderer.invoke('dsh-agent:bridge:open-file', request).catch(() => undefined);
		}, { capture: true });
	}
})();

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { isEqualOrParent } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { resolve } from '../../../base/common/path.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';

/** Custom protocol that serves the embedded dsh Agent application. */
export const DSH_AGENT_SCHEME = 'dsh-agent';
/** Single authority the Agent application may navigate to. */
export const DSH_AGENT_AUTHORITY = 'app';
/** Origin shared by every dsh Agent document. */
export const DSH_AGENT_ORIGIN = `${DSH_AGENT_SCHEME}://${DSH_AGENT_AUTHORITY}`;
/** Payload version of the preload bridge. */
export const DSH_AGENT_BRIDGE_PROTOCOL_VERSION = 1;
/** Session partition owned by the Agent window. */
export const DSH_AGENT_PARTITION = 'persist:tscode-dsh-agent';
/** Directory name below the user data directory used for logs and crash reports. */
export const DSH_AGENT_LOG_DIRECTORY = 'dsh-agent';
/** Default dsh profile booted by the Agent window. */
export const DSH_AGENT_DEFAULT_PROFILE = 'web';
/** Maximum length accepted for a filesystem path crossing the bridge. */
export const DSH_AGENT_MAX_PATH_LENGTH = 4096;
/** Maximum length accepted for a context string crossing the bridge. */
export const DSH_AGENT_MAX_CONTEXT_TEXT_LENGTH = 64 * 1024;

/** Lifecycle state of the embedded Agent. */
export const enum DshAgentStatus {
	Stopped = 'stopped',
	Starting = 'starting',
	Ready = 'ready',
	Restarting = 'restarting',
	SafeMode = 'safe-mode',
	Failed = 'failed'
}

/** IPC channels callable from the workbench through the main process channel. */
export interface IDshAgentMainService {
	/** Show (or focus) the Agent window, starting the Host on first use. */
	openWindow(): Promise<void>;
	/** Hide the Agent window without stopping the Host. */
	closeWindow(): Promise<void>;
	/** Current Agent status for command and settings surfaces. */
	getStatus(): Promise<IDshAgentStatusInfo>;
	/** Latest IDE context pushed by the workbench. */
	updateContext(context: unknown): Promise<void>;
}

/** Primary IDE context shared with the Agent frontend. */
export interface IDshAgentContext {
	readonly revision: number;
	readonly trusted: boolean;
	readonly workspaceFolders: readonly string[];
	readonly activeFile?: string;
	readonly languageId?: string;
	readonly selection?: IDshAgentSelection;
	readonly theme: 'light' | 'dark' | 'hc' | 'hc-light';
	readonly locale: string;
}

/** One editor selection, clipped to a bounded payload. */
export interface IDshAgentSelection {
	readonly path: string;
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
	readonly text: string;
}

/** Status snapshot returned to the workbench. */
export interface IDshAgentStatusInfo {
	readonly status: DshAgentStatus;
	readonly enabled: boolean;
	readonly restartCount: number;
	readonly safeMode: boolean;
	readonly origin?: string;
	readonly lastError?: string;
}

/** Request to open a file in the IDE editor. */
export interface IDshAgentOpenFileRequest {
	readonly path: string;
	readonly line?: number;
	readonly column?: number;
	readonly preserveFocus?: boolean;
}

/** Request to open a diff view in the IDE. */
export interface IDshAgentOpenDiffRequest {
	readonly path: string;
	readonly originalPath?: string;
	readonly line?: number;
	readonly preserveFocus?: boolean;
}

/** Renderer channel names owned by the Agent bridge. */
export const enum DshAgentRendererChannel {
	/** Main -> workbench: open a file. */
	OpenFile = 'vscode:dshAgentOpenFile',
	/** Main -> workbench: open a diff. */
	OpenDiff = 'vscode:dshAgentOpenDiff'
}

/** Preload IPC channel names. Every channel is a request/response pair except events. */
export const enum DshAgentIpcChannel {
	Context = 'dsh-agent:bridge:context',
	ContextChanged = 'dsh-agent:bridge:context-changed',
	OpenFile = 'dsh-agent:bridge:open-file',
	OpenDiff = 'dsh-agent:bridge:open-diff',
	RevealInExplorer = 'dsh-agent:bridge:reveal',
	PickDirectory = 'dsh-agent:bridge:pick-directory',
	Status = 'dsh-agent:bridge:status',
	Ready = 'dsh-agent:bridge:ready',
	ThemeChanged = 'dsh-agent:bridge:theme-changed'
}

/** Name of the main-process IPC channel exposed to the workbench. */
export const DSH_AGENT_MAIN_CHANNEL = 'dshAgent';

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const READY_LINE_PATTERN = /^dsh web:\s+(\S+)\s*$/;
const TOKEN_PATTERN = /([?&]token=)[^&\s]+/gi;
const COOKIE_VALUE_PATTERN = /((?:set-cookie|cookie)\s*:\s*)[^\r\n]*/gi;
const BEARER_PATTERN = /(authorization\s*:\s*bearer\s+)[^\s]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /((?:api[_-]?key|secret|password|token)\s*[:=]\s*)[^\s,;]+/gi;

/** Strip terminal escape sequences from a Host log line. */
export function stripAnsi(value: string): string {
	return value.replace(ANSI_PATTERN, '');
}

/**
 * Extract the authenticated Host URL from one stdout line of `dsh web`.
 * Only loopback HTTP(S) URLs carrying a token are accepted.
 */
export function parseDshHostReadyLine(line: string): string | undefined {
	const match = READY_LINE_PATTERN.exec(stripAnsi(line).trim());
	if (!match) {
		return undefined;
	}
	const candidate = match[1];
	if (!isLoopbackHttpUrl(candidate)) {
		return undefined;
	}
	const url = new URL(candidate);
	if (!url.searchParams.has('token')) {
		return undefined;
	}
	return candidate;
}

/** Whether a URL is plain HTTP(S) on a loopback address with no embedded credentials. */
export function isLoopbackHttpUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return false;
	}
	if (url.username !== '' || url.password !== '') {
		return false;
	}
	return isLoopbackHostname(url.hostname);
}

/** Whether a hostname names the local machine. */
export function isLoopbackHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** Whether navigation stays inside the Agent application origin. */
export function isAllowedDshAgentNavigation(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return url.protocol === `${DSH_AGENT_SCHEME}:` && url.hostname === DSH_AGENT_AUTHORITY;
}

/**
 * Resolve a request path to the path forwarded to the Host.
 * Returns `undefined` for paths that could escape the application root.
 */
export function resolveDshAgentRequestPath(pathname: string): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	if (decoded.includes('\0') || decoded.includes('\\')) {
		return undefined;
	}
	if (decoded === '' || decoded === '/') {
		return '/';
	}
	if (!decoded.startsWith('/') || decoded.includes('//')) {
		return undefined;
	}
	const segments = decoded.split('/');
	for (const segment of segments) {
		if (segment === '..' || segment === '.') {
			return undefined;
		}
	}
	return decoded;
}

/** Restart delay for a failed Host start: exponential with a bounded ceiling. */
export function computeDshAgentRestartDelay(attempt: number): number {
	const bounded = Math.max(0, Math.min(attempt, 5));
	return Math.min(500 * Math.pow(2, bounded), 8000);
}

/** Remove likely credentials from a Host log line before it is persisted or shown. */
export function redactDshAgentLog(value: string): string {
	return stripAnsi(value)
		.replace(COOKIE_VALUE_PATTERN, '$1[redacted]')
		.replace(BEARER_PATTERN, '$1[redacted]')
		.replace(TOKEN_PATTERN, '$1[redacted]')
		.replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]');
}

/** Compare a filesystem path against a set of trusted roots. */
export function isPathInsideRoots(candidate: string, roots: readonly string[]): boolean {
	if (roots.length === 0) {
		return false;
	}
	const candidateUri = URI.file(candidate);
	for (const root of roots) {
		const rootUri = URI.file(root);
		if (candidateUri.scheme !== rootUri.scheme) {
			continue;
		}
		if (isEqualOrParent(candidateUri, rootUri)) {
			return true;
		}
	}
	return false;
}

/** Validate a string that may be an absolute or workspace-relative path. */
export function isBoundedPathString(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > DSH_AGENT_MAX_PATH_LENGTH) {
		return false;
	}
	return !value.includes('\0') && !/[\r\n]/.test(value);
}

/** Validate an absolute path received from the embedded Agent. */
export function isSafeBridgePath(value: unknown): value is string {
	return isBoundedPathString(value) && isAbsolutePath(value);
}

/**
 * Resolve an Agent-supplied path and require it to stay inside a workspace root.
 * Relative paths resolve against the first root, matching dsh's single-root v1 scope.
 */
export function resolveBridgePath(value: unknown, roots: readonly string[]): string | undefined {
	if (!isBoundedPathString(value) || roots.length === 0) {
		return undefined;
	}
	const resolved = resolve(isAbsolutePath(value) ? value : resolve(roots[0], value));
	return isPathInsideRoots(resolved, roots) ? resolved : undefined;
}

/** Cross-platform absolute-path test that does not depend on the current platform. */
export function isAbsolutePath(value: string): boolean {
	if (isWindows) {
		return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
	}
	if (isLinux || isMacintosh) {
		return value.startsWith('/');
	}
	return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * Validate an `openFile` payload from the embedded Agent.
 * The caller separately checks that the path belongs to the workspace.
 */
export function validateOpenFileRequest(value: unknown): IDshAgentOpenFileRequest | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (!isBoundedPathString(candidate.path)) {
		return undefined;
	}
	const line = candidate.line === undefined ? undefined : sanitizePosition(candidate.line);
	const column = candidate.column === undefined ? undefined : sanitizePosition(candidate.column);
	if ((candidate.line !== undefined && line === undefined) || (candidate.column !== undefined && column === undefined)) {
		return undefined;
	}
	return {
		path: candidate.path,
		line,
		column,
		preserveFocus: candidate.preserveFocus === true
	};
}

/** Validate an `openDiff` payload from the embedded Agent. */
export function validateOpenDiffRequest(value: unknown): IDshAgentOpenDiffRequest | undefined {
	const request = validateOpenFileRequest(value);
	if (!request) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.originalPath === undefined) {
		return request;
	}
	if (!isBoundedPathString(candidate.originalPath)) {
		return undefined;
	}
	return { ...request, originalPath: candidate.originalPath };
}

function sanitizePosition(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 10_000_000) {
		return undefined;
	}
	return value;
}

/** Normalize and bound the context snapshot sent by the IDE. */
export function normalizeDshAgentContext(value: unknown, fallback: IDshAgentContext): IDshAgentContext {
	if (typeof value !== 'object' || value === null) {
		return fallback;
	}
	const candidate = value as Record<string, unknown>;
	const workspaceFolders = Array.isArray(candidate.workspaceFolders)
		? candidate.workspaceFolders.filter((folder): folder is string => isSafeBridgePath(folder)).slice(0, 32)
		: fallback.workspaceFolders;
	const activeFile = isSafeBridgePath(candidate.activeFile) ? candidate.activeFile : undefined;
	const languageId = typeof candidate.languageId === 'string' && candidate.languageId.length <= 128 ? candidate.languageId : undefined;
	const selection = normalizeSelection(candidate.selection, activeFile);
	const theme = candidate.theme === 'light' || candidate.theme === 'dark' || candidate.theme === 'hc' || candidate.theme === 'hc-light'
		? candidate.theme
		: fallback.theme;
	const locale = typeof candidate.locale === 'string' && /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})?$/.test(candidate.locale)
		? candidate.locale
		: fallback.locale;
	return {
		revision: fallback.revision + 1,
		trusted: candidate.trusted === true,
		workspaceFolders,
		activeFile,
		languageId,
		selection,
		theme,
		locale
	};
}

function normalizeSelection(value: unknown, activeFile: string | undefined): IDshAgentSelection | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (!isSafeBridgePath(candidate.path) || candidate.path !== activeFile) {
		return undefined;
	}
	const startLine = sanitizePosition(candidate.startLine);
	const startColumn = sanitizePosition(candidate.startColumn);
	const endLine = sanitizePosition(candidate.endLine);
	const endColumn = sanitizePosition(candidate.endColumn);
	if (startLine === undefined || startColumn === undefined || endLine === undefined || endColumn === undefined) {
		return undefined;
	}
	const text = typeof candidate.text === 'string' ? candidate.text.slice(0, DSH_AGENT_MAX_CONTEXT_TEXT_LENGTH) : '';
	return { path: candidate.path, startLine, startColumn, endLine, endColumn, text };
}

/** Create the initial empty context. */
export function createEmptyDshAgentContext(theme: IDshAgentContext['theme'] = 'dark', locale = 'en'): IDshAgentContext {
	return { revision: 0, trusted: false, workspaceFolders: [], theme, locale };
}

/** Render the minimal error document served when the Host is unavailable. */
export function renderDshAgentErrorDocument(message: string): string {
	const escaped = message.replace(/[&<>"']/g, character => {
		switch (character) {
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			default: return '&#39;';
		}
	});
	return `<!doctype html><html><head><meta charset="utf-8"><title>dsh Agent</title><style>
		:root { color-scheme: light dark; }
		body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; display: grid; place-items: center; height: 100vh; }
		main { max-width: 520px; padding: 24px; }
		h1 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
		pre { white-space: pre-wrap; word-break: break-word; opacity: .8; }
	</style></head><body><main><h1>${localize('dshAgent.errorTitle', "dsh Agent failed to start")}</h1><pre>${escaped}</pre></main></body></html>`;
}

/** Whether the window is available under local and remote policy. */
export function resolveDshAgentEnabled(input: {
	readonly productEnabled: boolean | undefined;
	readonly killSwitch: boolean | undefined;
	readonly environmentDisabled: boolean;
	readonly settingEnabled: boolean;
}): boolean {
	if (input.killSwitch === true || input.productEnabled === false) {
		return false;
	}
	if (input.environmentDisabled || !input.settingEnabled) {
		return false;
	}
	return true;
}

/** Whether the IDE context permits starting the Host. */
export function checkDshAgentWorkspaceTrust(input: {
	readonly enabled: boolean;
	readonly requireTrustedWorkspace: boolean;
	readonly trusted: boolean;
	readonly hasWorkspaceFolder: boolean;
}): 'allowed' | 'disabled' | 'untrusted' {
	if (!input.enabled) {
		return 'disabled';
	}
	if (input.requireTrustedWorkspace && input.hasWorkspaceFolder && !input.trusted) {
		return 'untrusted';
	}
	return 'allowed';
}

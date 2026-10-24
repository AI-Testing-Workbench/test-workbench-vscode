/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isWindows } from '../../../../base/common/platform.js';
import {
	checkDshAgentWorkspaceTrust,
	computeDshAgentRestartDelay,
	createEmptyDshAgentContext,
	isAbsolutePath,
	isAllowedDshAgentNavigation,
	isLoopbackHttpUrl,
	isPathInsideRoots,
	normalizeDshAgentContext,
	resolveBridgePath,
	parseDshHostReadyLine,
	redactDshAgentLog,
	renderDshAgentErrorDocument,
	resolveDshAgentEnabled,
	resolveDshAgentRequestPath,
	validateOpenDiffRequest,
	validateOpenFileRequest
} from '../../common/dshAgent.js';

suite('dsh Agent protocol helpers', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses the dsh web ready line', () => {
		assert.strictEqual(
			parseDshHostReadyLine('dsh web: http://127.0.0.1:65443/?token=abc_DEF-123'),
			'http://127.0.0.1:65443/?token=abc_DEF-123'
		);
		assert.strictEqual(parseDshHostReadyLine('dsh web: http://localhost:8080/?token=x'), 'http://localhost:8080/?token=x');
	});

	test('rejects non-loopback or tokenless ready lines', () => {
		assert.strictEqual(parseDshHostReadyLine('dsh web: http://example.com/?token=x'), undefined);
		assert.strictEqual(parseDshHostReadyLine('dsh web: http://127.0.0.1:80/'), undefined);
		assert.strictEqual(parseDshHostReadyLine('starting'), undefined);
		assert.strictEqual(parseDshHostReadyLine('dsh web: file:///tmp/x?token=x'), undefined);
	});

	test('accepts only loopback HTTP(S) URLs', () => {
		assert.ok(isLoopbackHttpUrl('http://127.0.0.1:1/'));
		assert.ok(isLoopbackHttpUrl('https://localhost:1/'));
		assert.ok(isLoopbackHttpUrl('http://[::1]:1/'));
		assert.ok(!isLoopbackHttpUrl('http://10.0.0.1/'));
		assert.ok(!isLoopbackHttpUrl('http://user:pass@127.0.0.1/'));
		assert.ok(!isLoopbackHttpUrl('ws://127.0.0.1/'));
	});

	test('allows navigation only inside the Agent origin', () => {
		assert.ok(isAllowedDshAgentNavigation('dsh-agent://app/chat/1'));
		assert.ok(!isAllowedDshAgentNavigation('https://example.com'));
		assert.ok(!isAllowedDshAgentNavigation('dsh-agent://other/'));
		assert.ok(!isAllowedDshAgentNavigation('not a url'));
	});

	test('resolves only normalized request paths', () => {
		assert.strictEqual(resolveDshAgentRequestPath(''), '/');
		assert.strictEqual(resolveDshAgentRequestPath('/'), '/');
		assert.strictEqual(resolveDshAgentRequestPath('/plugins/a.js'), '/plugins/a.js');
		assert.strictEqual(resolveDshAgentRequestPath('/a%20b'), '/a b');
		assert.strictEqual(resolveDshAgentRequestPath('/../etc/passwd'), undefined);
		assert.strictEqual(resolveDshAgentRequestPath('/%2e%2e/etc/passwd'), undefined);
		assert.strictEqual(resolveDshAgentRequestPath('/a//b'), undefined);
		assert.strictEqual(resolveDshAgentRequestPath('/a\\b'), undefined);
		assert.strictEqual(resolveDshAgentRequestPath('/a%00b'), undefined);
		assert.strictEqual(resolveDshAgentRequestPath('/%E0%A4%A'), undefined);
	});

	test('resolves the feature flag and kill switch', () => {
		const base = { productEnabled: true, killSwitch: false, environmentDisabled: false, settingEnabled: true };
		assert.strictEqual(resolveDshAgentEnabled(base), true);
		assert.strictEqual(resolveDshAgentEnabled({ ...base, killSwitch: true }), false);
		assert.strictEqual(resolveDshAgentEnabled({ ...base, productEnabled: false }), false);
		assert.strictEqual(resolveDshAgentEnabled({ ...base, environmentDisabled: true }), false);
		assert.strictEqual(resolveDshAgentEnabled({ ...base, settingEnabled: false }), false);
		assert.strictEqual(resolveDshAgentEnabled({ ...base, productEnabled: undefined }), true);
	});

	test('requires trust only when a workspace folder is open', () => {
		assert.strictEqual(checkDshAgentWorkspaceTrust({ enabled: true, requireTrustedWorkspace: true, trusted: false, hasWorkspaceFolder: true }), 'untrusted');
		assert.strictEqual(checkDshAgentWorkspaceTrust({ enabled: true, requireTrustedWorkspace: true, trusted: false, hasWorkspaceFolder: false }), 'allowed');
		assert.strictEqual(checkDshAgentWorkspaceTrust({ enabled: true, requireTrustedWorkspace: false, trusted: false, hasWorkspaceFolder: true }), 'allowed');
		assert.strictEqual(checkDshAgentWorkspaceTrust({ enabled: false, requireTrustedWorkspace: false, trusted: true, hasWorkspaceFolder: true }), 'disabled');
	});

	test('bounds restart backoff', () => {
		assert.strictEqual(computeDshAgentRestartDelay(0), 500);
		assert.strictEqual(computeDshAgentRestartDelay(1), 1000);
		assert.strictEqual(computeDshAgentRestartDelay(3), 4000);
		assert.strictEqual(computeDshAgentRestartDelay(10), 8000);
		assert.strictEqual(computeDshAgentRestartDelay(-1), 500);
	});

	test('redacts credentials from logs', () => {
		const redacted = redactDshAgentLog('dsh web: http://127.0.0.1:1/?token=SECRET and cookie: abc; Authorization: Bearer xyz');
		assert.ok(!redacted.includes('SECRET'));
		assert.ok(!redacted.includes('Bearer xyz'));
		assert.ok(!redacted.includes('abc'));
		assert.ok(redacted.includes('[redacted]'));
	});

	test('escapes the error document', () => {
		const html = renderDshAgentErrorDocument('<script>alert(1)</script>');
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(html.includes('&lt;script&gt;'));
	});

	test('checks filesystem roots', () => {
		const root = isWindows ? 'C:\\work\\repo' : '/work/repo';
		const inside = isWindows ? 'C:\\work\\repo\\src\\a.ts' : '/work/repo/src/a.ts';
		const sibling = isWindows ? 'C:\\work\\repo-other\\a.ts' : '/work/repo-other/a.ts';
		assert.ok(isPathInsideRoots(inside, [root]));
		assert.ok(isPathInsideRoots(root, [root]));
		assert.ok(!isPathInsideRoots(sibling, [root]));
		assert.ok(!isPathInsideRoots('/etc/passwd', []));
	});

	test('validates open-file payloads', () => {
		const validPath = isWindows ? 'C:\\work\\repo\\a.ts' : '/work/repo/a.ts';
		assert.deepStrictEqual(validateOpenFileRequest({ path: validPath }), {
			path: validPath,
			line: undefined,
			column: undefined,
			preserveFocus: false
		});
		assert.deepStrictEqual(validateOpenFileRequest({ path: 'relative/a.ts' })?.path, 'relative/a.ts');
		assert.strictEqual(validateOpenFileRequest({ path: validPath, line: 0 }), undefined);
		assert.strictEqual(validateOpenFileRequest({ path: `${validPath}\nrm -rf` }), undefined);
		assert.strictEqual(validateOpenFileRequest(null), undefined);
		assert.deepStrictEqual(validateOpenDiffRequest({ path: validPath, originalPath: validPath }), {
			path: validPath,
			line: undefined,
			column: undefined,
			preserveFocus: false,
			originalPath: validPath
		});
	});

	test('resolves relative paths inside the first workspace root', () => {
		const root = isWindows ? 'C:\\work\\repo' : '/work/repo';
		assert.strictEqual(resolveBridgePath('src/a.ts', [root]), isWindows ? 'C:\\work\\repo\\src\\a.ts' : '/work/repo/src/a.ts');
		assert.strictEqual(resolveBridgePath('../outside.ts', [root]), undefined);
		assert.strictEqual(resolveBridgePath(isWindows ? 'D:\\x.ts' : '/other/x.ts', [root]), undefined);
		assert.strictEqual(resolveBridgePath('a.ts', []), undefined);
	});

	test('absolute path test matches the running platform', () => {
		assert.ok(isAbsolutePath(isWindows ? 'C:\\a' : '/a'));
		assert.ok(!isAbsolutePath('a/b'));
	});

	test('normalizes and bounds IDE context', () => {
		const root = isWindows ? 'C:\\work\\repo' : '/work/repo';
		const fallback = createEmptyDshAgentContext('dark', 'en');
		const context = normalizeDshAgentContext({
			trusted: true,
			workspaceFolders: [root, 'relative'],
			activeFile: `${root}/a.ts`,
			languageId: 'typescript',
			selection: {
				path: `${root}/a.ts`,
				startLine: 2,
				startColumn: 3,
				endLine: 2,
				endColumn: 8,
				text: 'x'.repeat(100_000)
			},
			theme: 'light',
			locale: 'zh-cn'
		}, fallback);
		assert.strictEqual(context.revision, 1);
		assert.strictEqual(context.trusted, true);
		assert.deepStrictEqual(context.workspaceFolders, [root]);
		assert.strictEqual(context.selection?.text.length, 64 * 1024);
		assert.strictEqual(context.theme, 'light');
		assert.strictEqual(context.locale, 'zh-cn');
	});

	test('keeps fallback values for malformed context', () => {
		const fallback = createEmptyDshAgentContext('hc', 'fr');
		const context = normalizeDshAgentContext({ theme: 'neon', locale: '<script>', workspaceFolders: 'x' }, fallback);
		assert.strictEqual(context.theme, 'hc');
		assert.strictEqual(context.locale, 'fr');
		assert.deepStrictEqual(context.workspaceFolders, []);
	});
});

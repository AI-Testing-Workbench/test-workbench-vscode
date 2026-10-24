/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { cp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'fs/promises';
import { dirname, join } from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { ILogService } from '../../log/common/log.js';
import { IDshAgentPaths } from '../common/dshAgentPaths.js';

/** dsh entry ids disabled by the v1 profile. Keep in sync with the security review. */
export const DSH_AGENT_DISABLED_PLUGINS: readonly string[] = [
	// Plugin installation and market surfaces are IDE-owned in v1.
	'plugin-manager',
	'tool-plugin-manager',
	'ui-plugin-manager',
	'ui-settings-plugins',
	'plugin-inventory',
	'ui-settings-plugin-inventory',
	'plugin-package-inventory-deepseek',
	// Live configuration reload is unsafe while the IDE does not own approval UX.
	'hmr'
];

const MANAGED_BEGIN = '# >>> tscode dsh-agent managed: do not edit this block >>>';
const MANAGED_END = '# <<< tscode dsh-agent managed <<<';

/** Facts persisted next to the profile so support can identify an installation. */
export interface IDshAgentProfileInfo {
	readonly profile: string;
	readonly dshHome: string;
	readonly runtimeVersion: string | undefined;
	readonly disabledPlugins: readonly string[];
	readonly profileHash: string;
	readonly format: number;
}

/** Result of preparing the isolated dsh home. */
export interface IDshAgentProfilePreparation {
	readonly info: IDshAgentProfileInfo;
	/** True when this launch initialized or repaired a managed file. */
	readonly changed: boolean;
	/** True when the tscode client plugin is available to the profile. */
	readonly pluginInstalled: boolean;
}

const PLUGIN_PACKAGE = 'dsh-client-tscode';
const DEFAULT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const;

/**
 * Create the isolated dsh home and enforce the v1 plugin allowlist.
 * The user's own edits outside the managed block are preserved.
 */
export async function prepareDshAgentProfile(paths: IDshAgentPaths, logService: ILogService): Promise<IDshAgentProfilePreparation> {
	await Promise.all([
		mkdir(join(paths.dshHome, 'profiles'), { recursive: true }),
		mkdir(paths.logDirectory, { recursive: true })
	]);

	const patchPath = join(paths.dshHome, 'cordis.patch.yml');
	const patchChanged = await ensureManagedPatchBlock(patchPath, logService);
	const pluginSource = join(paths.runtimeRoot, 'plugin', PLUGIN_PACKAGE);
	const profileChanged = await ensureProfileBundles(paths, pluginSource, logService);
	const info = createProfileInfo(paths);
	await writeFileAtomic(join(paths.dshHome, 'tscode-agent-profile.json'), JSON.stringify(info, undefined, '\t') + '\n');
	return { info, changed: patchChanged || profileChanged.changed, pluginInstalled: profileChanged.pluginInstalled };
}

/** Ensure the profile manifest loads the tscode client plugin without requiring pnpm. */
async function ensureProfileBundles(paths: IDshAgentPaths, pluginSource: string, logService: ILogService): Promise<{ changed: boolean; pluginInstalled: boolean }> {
	const profileDirectory = join(paths.dshHome, 'profiles', paths.profile);
	const manifestPath = join(profileDirectory, 'package.json');
	let manifest: Record<string, unknown>;
	let changed = false;
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
	} catch (error) {
		if (error instanceof SyntaxError) {
			// Never rewrite a profile the user is already editing; dsh will report it.
			logService.warn(`[dshAgent] profile ${paths.profile} has invalid JSON; the client plugin is not installed`);
			await ensureProfileFile(join(profileDirectory, 'cordis.yml'), '[]\n');
			await ensureProfileFile(join(profileDirectory, 'cordis.patch.yml'), '[]\n');
			return { changed: false, pluginInstalled: false };
		}
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
		manifest = {
			name: `dsh-profile-${paths.profile}`,
			private: true,
			dsh: { profile: { bundles: [...DEFAULT_BUNDLES, PLUGIN_PACKAGE] } }
		};
		changed = true;
	}
	const dsh = manifest.dsh;
	const profile = typeof dsh === 'object' && dsh !== null && typeof (dsh as Record<string, unknown>).profile === 'object'
		? (dsh as { profile: Record<string, unknown> }).profile
		: undefined;
	const bundles = profile && Array.isArray(profile.bundles) ? profile.bundles as unknown[] : undefined;
	if (bundles && !bundles.includes(PLUGIN_PACKAGE) && existsSync(pluginSource)) {
		bundles.push(PLUGIN_PACKAGE);
		changed = true;
	}
	if (!bundles) {
		logService.warn(`[dshAgent] profile ${paths.profile} has an unrecognized bundle list; the client plugin is not installed`);
	}
	if (changed) {
		await writeFileAtomic(manifestPath, JSON.stringify(manifest, undefined, '\t') + '\n');
	}
	await ensureProfileFile(join(profileDirectory, 'cordis.yml'), '[]\n');
	await ensureProfileFile(join(profileDirectory, 'cordis.patch.yml'), '[]\n');
	if (!existsSync(pluginSource)) {
		return { changed, pluginInstalled: false };
	}
	try {
		const pluginInstalled = await ensurePluginLink(profileDirectory, pluginSource);
		return { changed: changed || pluginInstalled.changed, pluginInstalled: true };
	} catch (error) {
		logService.warn(`[dshAgent] could not provision the client plugin: ${error instanceof Error ? error.message : String(error)}`);
		return { changed, pluginInstalled: false };
	}
}

async function ensureProfileFile(path: string, content: string): Promise<void> {
	if (!existsSync(path)) {
		await writeFileAtomic(path, content);
	}
}

async function ensurePluginLink(profileDirectory: string, pluginSource: string): Promise<{ changed: boolean }> {
	const nodeModules = join(profileDirectory, 'node_modules');
	const link = join(nodeModules, PLUGIN_PACKAGE);
	await mkdir(nodeModules, { recursive: true });
	try {
		if ((await realpath(link)) === (await realpath(pluginSource))) {
			return { changed: false };
		}
	} catch {
		// Missing or dangling link; replace it below.
	}
	await rm(link, { recursive: true, force: true });
	try {
		await symlink(pluginSource, link, isWindows ? 'junction' : 'dir');
	} catch {
		// Windows can refuse symlink creation under restrictive policy; the plugin
		// is small, so a copy is a safe fallback.
		await cp(pluginSource, link, { recursive: true });
	}
	return { changed: true };
}

function createProfileInfo(paths: IDshAgentPaths): IDshAgentProfileInfo {
	const payload = JSON.stringify({
		format: 1,
		profile: paths.profile,
		runtimeVersion: paths.runtimeVersion ?? null,
		disabledPlugins: DSH_AGENT_DISABLED_PLUGINS
	});
	return {
		profile: paths.profile,
		dshHome: paths.dshHome,
		runtimeVersion: paths.runtimeVersion,
		disabledPlugins: DSH_AGENT_DISABLED_PLUGINS,
		profileHash: createHash('sha256').update(payload).digest('hex').slice(0, 16),
		format: 1
	};
}

/** Return the managed patch content. */
export function renderManagedPatchBlock(disabledPlugins: readonly string[] = DSH_AGENT_DISABLED_PLUGINS): string {
	const rows = disabledPlugins.map(id => `- id: ${id}\n  disabled: true`);
	return `${MANAGED_BEGIN}\n${rows.join('\n')}\n${MANAGED_END}\n`;
}

/**
 * Install or refresh the managed block without disturbing user rows.
 * Returns whether the file changed.
 */
async function ensureManagedPatchBlock(patchPath: string, logService: ILogService): Promise<boolean> {
	let existing = '';
	try {
		existing = await readFile(patchPath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	const block = renderManagedPatchBlock();
	const begin = existing.indexOf(MANAGED_BEGIN);
	const end = existing.indexOf(MANAGED_END);
	let next: string;
	if (begin >= 0 && end > begin) {
		next = existing.slice(0, begin) + block + existing.slice(end + MANAGED_END.length).replace(/^\r?\n/, '');
	} else {
		next = hasUserRows(existing) ? `${existing.replace(/\s*$/, '')}\n${block}` : block;
	}
	if (next === existing) {
		return false;
	}
	await writeFileAtomic(patchPath, next);
	logService.info(`[dshAgent] profile patch written to ${patchPath}`);
	return true;
}

function hasUserRows(content: string): boolean {
	const rows = content
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#') && line !== '[]');
	return rows.length > 0;
}

/** Write a file through a sibling temporary file so a crashed write never truncates it. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, content, { mode: 0o600 });
	await rename(temporary, path);
}

/** Remove the managed profile files. Used by the uninstall/cleanup command. */
export async function removeDshAgentProfileFiles(paths: IDshAgentPaths): Promise<boolean> {
	const marker = join(paths.dshHome, 'tscode-agent-profile.json');
	if (!existsSync(marker)) {
		return false;
	}
	const patch = join(paths.dshHome, 'cordis.patch.yml');
	try {
		const content = await readFile(patch, 'utf8');
		const begin = content.indexOf(MANAGED_BEGIN);
		const end = content.indexOf(MANAGED_END);
		if (begin >= 0 && end > begin) {
			const remaining = (content.slice(0, begin) + content.slice(end + MANAGED_END.length)).trim();
			await writeFileAtomic(patch, remaining === '' ? '[]\n' : `${remaining}\n`);
		}
	} catch {
		// A missing patch is already clean.
	}
	await rm(marker, { force: true });
	return true;
}

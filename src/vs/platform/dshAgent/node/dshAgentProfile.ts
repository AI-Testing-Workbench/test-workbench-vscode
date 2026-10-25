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

/**
 * dsh entry ids disabled by the managed profile.
 *
 * The tscode integration keeps dsh's native extension model, including plugin
 * management UI, inventory, market, hot reload, and the agent's
 * `plugin_manager` tool. `plugin-manager` / `tool-plugin-manager` must remain
 * enabled because shipped agent presets mount the tool; disabling the service
 * makes every new session fail with `agent-preset/invalid`.
 *
 * Keep this list empty unless a profile row genuinely cannot run under the
 * embedded window. An empty list removes the managed block and leaves the
 * profile patch as a valid empty YAML array or the user's own rows.
 */
export const DSH_AGENT_DISABLED_PLUGINS: readonly string[] = [];

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

const CLIENT_PLUGIN_PACKAGE = 'dsh-client-tscode';
const DEFAULT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const;

/**
 * Bundles provisioned from `resources/dsh-agent/plugin` on every launch, in
 * profile load order. The tscode bridge stays first because it owns the IDE
 * integration. A built-in whose staged source is absent is skipped, so an older
 * runtime still starts after the application code moves ahead.
 */
export const DSH_AGENT_BUILTIN_PLUGINS: readonly string[] = [CLIENT_PLUGIN_PACKAGE, 'dsh-plugin-offline'];

/**
 * Create the isolated dsh home and keep the managed profile patch in sync.
 * The user's own edits outside the managed block are preserved.
 */
export async function prepareDshAgentProfile(paths: IDshAgentPaths, logService: ILogService): Promise<IDshAgentProfilePreparation> {
	await Promise.all([
		mkdir(join(paths.dshHome, 'profiles'), { recursive: true }),
		mkdir(paths.logDirectory, { recursive: true })
	]);

	const patchPath = join(paths.dshHome, 'cordis.patch.yml');
	const patchChanged = await ensureManagedPatchBlock(patchPath, logService);
	const profileChanged = await ensureProfileBundles(paths, logService);
	const info = createProfileInfo(paths);
	await writeFileAtomic(join(paths.dshHome, 'tscode-agent-profile.json'), JSON.stringify(info, undefined, '\t') + '\n');
	return { info, changed: patchChanged || profileChanged.changed, pluginInstalled: profileChanged.pluginInstalled };
}

/** Ensure the profile manifest loads the built-in plugins without requiring pnpm. */
async function ensureProfileBundles(paths: IDshAgentPaths, logService: ILogService): Promise<{ changed: boolean; pluginInstalled: boolean }> {
	const profileDirectory = join(paths.dshHome, 'profiles', paths.profile);
	const manifestPath = join(profileDirectory, 'package.json');
	const pluginSources = new Map(DSH_AGENT_BUILTIN_PLUGINS.map(name => [name, join(paths.runtimeRoot, 'plugin', name)]));
	const availablePlugins = DSH_AGENT_BUILTIN_PLUGINS.filter(name => existsSync(pluginSources.get(name)!));
	let manifest: Record<string, unknown>;
	let changed = false;
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
	} catch (error) {
		if (error instanceof SyntaxError) {
			// Never rewrite a profile the user is already editing; dsh will report it.
			logService.warn(`[dshAgent] profile ${paths.profile} has invalid JSON; the built-in plugins are not installed`);
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
			dsh: { profile: { bundles: [...DEFAULT_BUNDLES, ...availablePlugins] } }
		};
		changed = true;
	}
	const dsh = manifest.dsh;
	const profile = typeof dsh === 'object' && dsh !== null && typeof (dsh as Record<string, unknown>).profile === 'object'
		? (dsh as { profile: Record<string, unknown> }).profile
		: undefined;
	const bundles = profile && Array.isArray(profile.bundles) ? profile.bundles as unknown[] : undefined;
	if (bundles) {
		for (const name of availablePlugins) {
			if (!bundles.includes(name)) {
				bundles.push(name);
				changed = true;
			}
		}
	} else {
		logService.warn(`[dshAgent] profile ${paths.profile} has an unrecognized bundle list; the built-in plugins are not installed`);
	}
	if (changed) {
		await writeFileAtomic(manifestPath, JSON.stringify(manifest, undefined, '\t') + '\n');
	}
	await ensureProfileFile(join(profileDirectory, 'cordis.yml'), '[]\n');
	await ensureProfileFile(join(profileDirectory, 'cordis.patch.yml'), '[]\n');
	let pluginInstalled = false;
	for (const name of availablePlugins) {
		try {
			const linked = await ensurePluginLink(profileDirectory, pluginSources.get(name)!, name);
			changed = changed || linked.changed;
			if (name === CLIENT_PLUGIN_PACKAGE) {
				pluginInstalled = true;
			}
		} catch (error) {
			logService.warn(`[dshAgent] could not provision ${name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { changed, pluginInstalled };
}

async function ensureProfileFile(path: string, content: string): Promise<void> {
	if (!existsSync(path)) {
		await writeFileAtomic(path, content);
	}
}

async function ensurePluginLink(profileDirectory: string, pluginSource: string, packageName: string): Promise<{ changed: boolean }> {
	const nodeModules = join(profileDirectory, 'node_modules');
	const link = join(nodeModules, packageName);
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

/** Return the managed patch block, or an empty string when nothing is disabled. */
export function renderManagedPatchBlock(disabledPlugins: readonly string[] = DSH_AGENT_DISABLED_PLUGINS): string {
	if (disabledPlugins.length === 0) {
		return '';
	}
	const rows = disabledPlugins.map(id => `- id: ${id}\n  disabled: true`);
	return `${MANAGED_BEGIN}\n${rows.join('\n')}\n${MANAGED_END}\n`;
}

/**
 * Install or refresh the managed block without disturbing user rows.
 * When nothing is disabled, remove the block and keep the patch file valid.
 * Returns whether the file changed.
 */
async function ensureManagedPatchBlock(patchPath: string, logService: ILogService): Promise<boolean> {
	let existing = '';
	let fileExists = true;
	try {
		existing = await readFile(patchPath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
		fileExists = false;
	}

	const block = renderManagedPatchBlock();
	const begin = existing.indexOf(MANAGED_BEGIN);
	const end = existing.indexOf(MANAGED_END);
	let next: string;
	if (begin >= 0 && end > begin) {
		next = existing.slice(0, begin) + block + existing.slice(end + MANAGED_END.length).replace(/^\r?\n/, '');
	} else if (block.length > 0) {
		next = hasUserRows(existing) ? `${existing.replace(/\s*$/, '')}\n${block}` : block;
	} else {
		next = existing;
	}

	if (block.length === 0) {
		// A comments-only file parses as null and makes dsh reject the profile
		// patch. Keep user rows, otherwise leave a valid empty array (or no file).
		if (hasUserRows(next)) {
			next = `${next.replace(/\s*$/, '')}\n`;
		} else if (fileExists) {
			next = '[]\n';
		} else {
			next = '';
		}
	}

	if (next === existing) {
		return false;
	}
	if (next === '') {
		await rm(patchPath, { force: true });
		logService.info(`[dshAgent] profile patch removed from ${patchPath}`);
		return true;
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

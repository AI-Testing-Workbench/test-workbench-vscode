/**
 * Profile discovery and installed-bundle helpers for dsh-plugin-offline.
 *
 * The tool runs inside the DSH Host, which may be launched by the Desktop app or
 * by `dsh`; this module finds the running profile directory without assuming
 * either launcher, and reads the profile's installed bundles through the
 * `pluginManager` service.
 * @module dsh-plugin-offline/profile
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A failure with a stable machine-readable code and a model-readable message. */
export class OfflineError extends Error {
  /**
   * @param code - stable failure code, e.g. `unknown-plugin`.
   * @param message - one sentence the model and the user can act on.
   * @param options - standard Error options (`cause`).
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = 'OfflineError';
    this.code = code;
  }
}

/**
 * Read one JSON file.
 * @param path - absolute file path.
 * @returns the parsed value.
 * @throws {Error} when the file is absent or malformed.
 */
export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Resolve the Harness home exactly as DSH does: `$DSH_HOME` when set and
 * non-blank, otherwise `~/.dsh`.
 * @param env - environment mapping; defaults to the process environment.
 * @returns the absolute Harness home.
 */
export function resolveDshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  return configured === '' ? join(homedir(), '.dsh') : resolve(configured);
}

/**
 * Derive the profile directory from this plugin's own installed location: the
 * profile is the nearest ancestor directory whose manifest declares
 * `dsh.profile.bundles`. Works for hoisted and isolated pnpm layouts; returns
 * undefined for a workspace-linked install, whose real path is outside the
 * profile.
 * @param moduleUrl - module URL to start from; defaults to this module.
 * @returns the profile directory, or undefined when none is an ancestor.
 */
export function deriveProfileDirFromModule(moduleUrl = import.meta.url) {
  let file;
  try {
    file = realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return undefined;
  }
  let dir = dirname(file);
  for (;;) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    try {
      const manifest = readJsonFile(join(dir, 'package.json'));
      if (Array.isArray(manifest?.dsh?.profile?.bundles)) return dir;
    } catch {
      // No manifest here, or an unreadable one: keep walking up.
    }
    dir = parent;
  }
}

/**
 * Locate the running profile directory. Precedence: the live `profileContext`
 * service, `$DSH_PROFILE_DIR`, this plugin's own install location, then
 * `$DSH_HOME/profiles/<name>`.
 * @param ctx - Host plugin context (may expose `profileContext`).
 * @returns the absolute profile directory.
 * @throws {OfflineError} with code `profile-not-found` when nothing matches.
 */
export function resolveProfileDir(ctx) {
  const context = safeGet(ctx, 'profileContext');
  const candidates = [];
  if (typeof context?.dir === 'string' && context.dir !== '') candidates.push(context.dir);
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    candidates.push(process.env.DSH_PROFILE_DIR);
  }
  const derived = deriveProfileDirFromModule();
  if (derived !== undefined) candidates.push(derived);
  const home = resolveDshHome();
  const profileName = typeof context?.name === 'string' && context.name !== ''
    ? context.name
    : process.env.DSH_PROFILE;
  if (typeof profileName === 'string' && profileName !== '') candidates.push(join(home, 'profiles', profileName));

  for (const candidate of candidates) {
    try {
      const dir = realpathSync(candidate);
      const manifest = readJsonFile(join(dir, 'package.json'));
      if (manifest !== null && typeof manifest === 'object'
        && (Array.isArray(manifest?.dsh?.profile?.bundles) || existsSync(join(dir, 'cordis.yml')))) {
        return dir;
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new OfflineError(
    'profile-not-found',
    `Cannot locate the running DSH profile directory. Tried: ${candidates.length === 0 ? '(none)' : candidates.join(', ')}.`,
  );
}

/**
 * Read the profile's installed bundles, reduced to the fields the offline tool
 * reports. Shipped bundles are kept so the model can explain why they cannot be
 * exported.
 * @param ctx - Host plugin context exposing `pluginManager`.
 * @returns plain bundle rows sorted by name.
 */
export async function listInstalledBundles(ctx) {
  const manager = getPluginManager(ctx);
  const rows = await manager.listBundles();
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row) => ({
      name: row?.name,
      ...(row?.version === undefined ? {} : { version: row.version }),
      installed: row?.installed === true,
      enabled: row?.enabled === true,
      removable: row?.removable === true,
      ...(typeof row?.description === 'string' && row.description !== ''
        ? { description: row.description.length > 240 ? `${row.description.slice(0, 237)}...` : row.description }
        : {}),
      ...(row?.error === undefined ? {} : { error: row.error }),
      rows: Array.isArray(row?.rows)
        ? row.rows
          .map((declared) => ({ id: declared?.rowId, name: declared?.moduleName, entryId: declared?.entryId, disabled: declared?.disabled === true }))
          .filter((declared) => typeof declared.name === 'string' && declared.name !== '')
        : [],
    }))
    .filter((row) => typeof row.name === 'string' && row.name !== '')
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The installation anchor the running launcher supplied for this profile: the
 * absolute path of a file inside the DSH app package (its `package.json`).
 * Desktop exposes it through `profileContext`; it is absent on some hosts.
 * @param ctx - Host plugin context.
 * @returns the anchor path, or undefined.
 */
export function installAnchorOf(ctx) {
  const context = safeGet(ctx, 'profileContext');
  return typeof context?.installAnchor === 'string' && context.installAnchor !== ''
    ? context.installAnchor
    : undefined;
}

/**
 * Read the running DSH runtime version. The launcher's installation anchor is
 * the authority (the DSH app package manifest, also readable inside
 * `app.asar`); when the Host exposes no anchor, fall back to importing the
 * shipped runtime helper.
 * @param ctx - Host plugin context.
 * @returns the runtime version string, or undefined when unavailable.
 */
export function getRuntimeVersion(ctx) {
  const anchor = installAnchorOf(ctx);
  if (anchor !== undefined) {
    const version = readPackageVersion(anchor);
    if (version !== undefined) return version;
  }
  cachedFallbackVersion ??= (async () => {
    try {
      const boot = await import('@deepseek-ai/dsh-app-boot');
      const version = typeof boot.getDshRuntimeVersion === 'function' ? boot.getDshRuntimeVersion() : undefined;
      return typeof version === 'string' && version !== '' ? version : undefined;
    } catch {
      return undefined;
    }
  })();
  return cachedFallbackVersion;
}
let cachedFallbackVersion;

/**
 * Read `version` from a package manifest path or a directory holding one.
 * @param path - absolute manifest path or package directory.
 * @returns the version string, or undefined.
 */
function readPackageVersion(path) {
  const candidates = [path];
  try {
    if (statSync(path).isDirectory()) candidates.push(join(path, 'package.json'));
  } catch {
    // The caller's path may already be a manifest.
  }
  for (const candidate of candidates) {
    try {
      const manifest = readJsonFile(candidate);
      if (typeof manifest?.version === 'string' && manifest.version !== '') return manifest.version;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/**
 * Resolve the profile manager service, with one mode-independent error.
 * @param ctx - Host plugin context.
 * @returns the plugin-manager service.
 * @throws {OfflineError} with code `plugin-manager-unavailable`.
 */
export function getPluginManager(ctx) {
  const manager = ctx?.pluginManager ?? safeGet(ctx, 'pluginManager');
  if (manager === undefined || manager === null) {
    throw new OfflineError(
      'plugin-manager-unavailable',
      'This profile has no pluginManager service, so installed bundles cannot be listed or installed.',
    );
  }
  return manager;
}

/**
 * Read one optional service without turning a missing service into a throw.
 * @param ctx - Host plugin context.
 * @param name - exact service key.
 * @returns the service, or undefined.
 */
function safeGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

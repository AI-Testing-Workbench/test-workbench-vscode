/**
 * Export pipeline: turn one installed profile bundle into a self-contained
 * offline tarball (the plugin package plus its whole dependency closure,
 * declared as pnpm `bundleDependencies`, with a `dsh-offline.json` manifest).
 * @module dsh-plugin-offline/export
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { collectDependencyClosure, readManifest, resolvePackageDir, stageBundledPackage } from './closure.mjs';
import { packDirectoryToTarGz } from './tar.mjs';
import {
  OfflineError,
  getRuntimeVersion,
  listInstalledBundles,
  readJsonFile,
  resolveDshHome,
  resolveProfileDir,
} from './profile.mjs';

/** Schema version written into `dsh-offline.json`. */
export const SCHEMA_VERSION = 1;
/** Artifact metadata file name at the tarball's `package/` root. */
export const ARTIFACT_MANIFEST = 'dsh-offline.json';

/**
 * A filesystem-safe artifact file name for one plugin.
 * @param name - package name, scoped names included.
 * @param version - package version, if known.
 * @returns `<name>-<version>-offline.tgz` with scopes flattened.
 */
export function artifactFileName(name, version) {
  const safeName = String(name)
    .replace(/^@/, '')
    .replace(/[\\/]+/g, '__')
    .replace(/[^A-Za-z0-9._~-]+/g, '-');
  const safeVersion = String(version ?? '0.0.0').replace(/[^A-Za-z0-9._+~-]+/g, '-');
  return `${safeName}-${safeVersion}-offline.tgz`;
}

/**
 * Default directory for artifacts: `<DSH_HOME>/offline-artifacts`, so exports
 * survive in a stable place both DSH and the user can find.
 * @returns the absolute directory path.
 */
export function defaultArtifactDir() {
  return join(resolveDshHome(), 'offline-artifacts');
}

/**
 * Resolve the requested output target into a tarball file path.
 * @param output - optional absolute file or directory path.
 * @param name - package name.
 * @param version - package version.
 * @returns the absolute artifact path.
 * @throws {OfflineError} with code `invalid-output` for a relative path.
 */
export function resolveArtifactPath(output, name, version) {
  const fileName = artifactFileName(name, version);
  if (output === undefined || output === null || String(output).trim() === '') {
    return join(defaultArtifactDir(), fileName);
  }
  const raw = String(output).trim();
  if (!isAbsolute(raw)) {
    throw new OfflineError(
      'invalid-output',
      `output must be an absolute path (a .tgz file or an existing/new directory), received ${JSON.stringify(raw)}.`,
    );
  }
  return /\.(?:tgz|tar\.gz)$/i.test(raw) ? resolve(raw) : join(resolve(raw), fileName);
}

/**
 * Export one installed bundle as an offline artifact.
 * @param options.ctx - Host plugin context.
 * @param options.plugin - exact installed bundle name.
 * @param options.output - optional absolute artifact file or directory.
 * @returns a JSON-serializable summary of the artifact and its contents.
 */
export async function exportPlugin({ ctx, plugin, output }) {
  if (typeof plugin !== 'string' || plugin.trim() === '') {
    throw new OfflineError('invalid-plugin', 'plugin must be the exact name of an installed bundle; call action "list" first.');
  }
  const bundleName = plugin.trim();
  const profileDir = resolveProfileDir(ctx);
  const bundles = await listInstalledBundles(ctx);
  let declared = bundles.find((row) => row.name === bundleName);
  if (declared === undefined) {
    // `listBundles` lists selected bundles only. An installed dependency whose
    // bundle layer is switched off is still exportable, so fall back to the
    // profile manifest and let the bundle metadata check below decide.
    const profileManifest = readJsonFile(join(profileDir, 'package.json'));
    const dependencies = profileManifest?.dependencies ?? {};
    if (!Object.hasOwn(dependencies, bundleName)) {
      throw new OfflineError(
        'unknown-plugin',
        `No bundle named ${JSON.stringify(bundleName)} is installed in profile ${JSON.stringify(profileDir)}. Call action "list" for installed bundles.`,
      );
    }
    declared = { name: bundleName, installed: true, enabled: false, removable: true, rows: [] };
  }
  if (declared.installed !== true) {
    throw new OfflineError(
      'not-exportable',
      `${JSON.stringify(bundleName)} is supplied by the DSH installation, not installed in this profile, so it has no profile package to export. Only profile-installed bundles can be exported.`,
    );
  }

  const resolvedDir = resolvePackageDir(bundleName, profileDir);
  if (resolvedDir === undefined) {
    throw new OfflineError(
      'package-not-found',
      `The profile manifest lists ${JSON.stringify(bundleName)} but its package directory cannot be resolved from ${profileDir}. Reinstall the bundle with plugin_manager first.`,
    );
  }
  const rootDir = await realpathOf(resolvedDir);
  let rootManifest;
  try {
    rootManifest = readManifest(rootDir);
  } catch (error) {
    throw new OfflineError('manifest-unreadable', `Cannot read ${join(rootDir, 'package.json')}: ${String(error?.message ?? error)}`);
  }
  if (rootManifest?.dsh?.bundle?.patch === undefined) {
    throw new OfflineError(
      'not-a-bundle',
      `${JSON.stringify(bundleName)} declares no dsh.bundle.patch, so it is a plain dependency rather than a profile bundle. Export bundles only.`,
    );
  }

  const closure = await collectDependencyClosure({ rootPackageDir: rootDir });
  const dshVersion = await getRuntimeVersion(ctx);
  const target = {
    ...(dshVersion === undefined ? {} : { dshVersion }),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  const metadata = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'dsh-offline-plugin',
    plugin: {
      name: rootManifest.name,
      version: rootManifest.version,
      ...(typeof rootManifest.description === 'string' && rootManifest.description !== ''
        ? { description: rootManifest.description }
        : {}),
    },
    target,
    createdAt: new Date().toISOString(),
    source: { profile: profileDir.split(/[\\/]/).filter(Boolean).at(-1), profileDir },
    format: { tarball: 'npm-package-with-bundled-dependencies', prefix: 'package' },
    bundle: bundleLayerInfo(rootManifest, declared),
    packages: [],
    runtimeProvided: mergeRuntimeProvided(closure),
    notBundled: unresolvedItems(closure),
    warnings: [...(closure.warnings ?? [])],
  };

  const artifact = resolveArtifactPath(output, rootManifest.name, rootManifest.version);
  await mkdir(dirname(artifact), { recursive: true });
  const stagingRoot = await mkdtemp(join(tmpdir(), 'dsh-plugin-offline-'));
  try {
    const removedLifecycleScripts = [];
    const stage = await stageBundledPackage({
      closure,
      stagingDir: stagingRoot,
      // pnpm 11 refuses an install whose dependency declares build scripts it may
      // not run; on an isolated machine those scripts cannot run anyway and the
      // artifact already carries prebuilt files. Strip them from the artifact so
      // the offline install is deterministic.
      packageJsonTransform: (stagedManifest) => stripLifecycleScripts(stagedManifest, removedLifecycleScripts),
    });
    if (removedLifecycleScripts.length > 0) {
      metadata.scriptsRemoved = removedLifecycleScripts;
      metadata.warnings.push(
        `removed install-time lifecycle scripts ${removedLifecycleScripts.join(', ')} from the artifact manifest; `
        + 'the artifact carries prebuilt files and an offline install must not run build scripts.',
      );
    }
    if (existsSync(join(rootDir, 'binding.gyp'))) {
      metadata.nativeBuild = true;
      metadata.warnings.push(
        'the plugin declares binding.gyp (a native build); pnpm may require a build script on import, which cannot run offline.',
      );
    }
    metadata.packages = await withSizes(stage);
    metadata.notBundled = mergeNotBundled(metadata.notBundled, stage.removedDependencies);
    if (Array.isArray(stage.warnings)) metadata.warnings.push(...stage.warnings);
    metadata.warnings = [...new Set(metadata.warnings)];
    await writeArtifactManifest(stage.packageDir, metadata);
    await packDirectoryToTarGz({ sourceDir: stage.packageDir, outFile: artifact, prefix: 'package' });
    const info = await stat(artifact);
    return {
      action: 'export',
      artifact,
      bytes: info.size,
      plugin: metadata.plugin,
      target,
      packages: metadata.packages.map(({ name, version, path, kind }) => ({ name, version, path, kind })),
      packageCount: metadata.packages.length,
      runtimeProvided: metadata.runtimeProvided.map((item) => item.name),
      notBundled: metadata.notBundled.map((item) => item.name),
      warningCount: metadata.warnings.length,
      warnings: metadata.warnings.slice(0, 20),
      installHint: `Copy the artifact to the isolated machine, then run plugin_offline { action: "import", artifact: ${JSON.stringify(artifact)} } there (or plugin_manager { action: "install_bundle", target: <artifact path> }).`,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

/**
 * The bundle's patch declaration and inserted row ids, for the manifest.
 * @param manifest - the bundle's package manifest.
 * @param declared - the installed-bundle row from `listBundles`.
 * @returns the manifest `bundle` section.
 */
function bundleLayerInfo(manifest, declared) {
  const patch = manifest.dsh.bundle.patch;
  return {
    patch: Array.isArray(patch) ? patch : [patch],
    entries: Array.isArray(declared.rows) ? declared.rows.map((row) => row.id).filter((id) => typeof id === 'string') : [],
  };
}

/**
 * Deduplicate runtime-provided (skipped) dependencies by name.
 * @param closure - result of `collectDependencyClosure`.
 * @returns manifest entries with the first requester kept.
 */
function mergeRuntimeProvided(closure) {
  const seen = new Map();
  for (const item of closure.skipped ?? []) {
    if (!seen.has(item.name)) seen.set(item.name, { name: item.name, requestedBy: item.requestedBy });
  }
  return [...seen.values()];
}

/**
 * Dependencies that could not be bundled, from the closure walk.
 * @param closure - result of `collectDependencyClosure`.
 * @returns manifest `notBundled` entries.
 */
function unresolvedItems(closure) {
  return (closure.unresolved ?? []).map((item) => ({
    name: item.name,
    kind: item.kind,
    requestedBy: item.requestedBy,
    reason: item.kind === 'optional' ? 'optional dependency is not installed here' : 'dependency could not be resolved from the source profile',
  }));
}

/**
 * Merge staging removals into the manifest's not-bundled list.
 * @param existing - entries already collected from the closure walk.
 * @param removed - entries reported by the staging step.
 * @returns the merged list without duplicate names.
 */
function mergeNotBundled(existing, removed) {
  const byName = new Map(existing.map((item) => [item.name, item]));
  for (const item of removed ?? []) {
    if (!byName.has(item.name)) byName.set(item.name, { name: item.name, kind: 'dependency', reason: item.reason });
  }
  return [...byName.values()];
}

/**
 * Add per-package file counts and byte sizes to staging placements.
 * @param stage - result of `stageBundledPackage`.
 * @returns manifest package entries.
 */
async function withSizes(stage) {
  const packages = [];
  for (const placement of stage.placements ?? []) {
    const measured = await measureDirectory(join(stage.packageDir, placement.path));
    packages.push({
      name: placement.name,
      version: placement.version,
      path: placement.path,
      kind: placement.kind ?? 'dependency',
      files: measured.files,
      bytes: measured.bytes,
    });
  }
  return packages;
}

/**
 * Recursively count regular files and sum their sizes.
 * @param dir - directory to measure.
 * @returns the file count and byte total.
 */
async function measureDirectory(dir) {
  let files = 0;
  let bytes = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await measureDirectory(path);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      try {
        const info = await stat(path);
        files += 1;
        bytes += info.size;
      } catch {
        // A vanished file adds nothing to the summary.
      }
    }
  }
  return { files, bytes };
}

/**
 * Write `dsh-offline.json` at the staged package root.
 * @param packageDir - staged `package/` directory.
 * @param metadata - artifact metadata object.
 */
async function writeArtifactManifest(packageDir, metadata) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(packageDir, ARTIFACT_MANIFEST), `${JSON.stringify(metadata, undefined, 2)}\n`, 'utf8');
}

/**
 * Follow symlinks to one canonical directory path.
 * @param path - path that may be a symlink.
 * @returns the real path.
 */
async function realpathOf(path) {
  const { realpath } = await import('node:fs/promises');
  return realpath(path);
}

/**
 * Delete install-time lifecycle scripts from the staged root manifest.
 * @param manifest - staged package manifest (mutated copy).
 * @param removed - collector receiving the removed script names.
 * @returns the same manifest object.
 */
function stripLifecycleScripts(manifest, removed) {
  if (manifest === null || typeof manifest !== 'object') return manifest;
  const scripts = manifest.scripts;
  if (scripts === null || typeof scripts !== 'object') return manifest;
  for (const name of ['preinstall', 'install', 'postinstall']) {
    if (Object.hasOwn(scripts, name)) {
      delete scripts[name];
      removed.push(name);
    }
  }
  if (Object.keys(scripts).length === 0) delete manifest.scripts;
  return manifest;
}

/**
 * Import pipeline: validate an offline artifact, then install it into the
 * current profile through the profile's own `pluginManager`, which persists the
 * dependency, selects the bundle layer and applies the live composition — with
 * no registry access because every dependency is bundled in the tarball.
 * @module dsh-plugin-offline/import
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { extractTarGz, readTarGzTextEntry } from './tar.mjs';
import { OfflineError, getRuntimeVersion, readJsonFile, resolveProfileDir } from './profile.mjs';

/** Schema version this module understands. */
const SUPPORTED_SCHEMA_VERSION = 1;
/** Metadata file inside the artifact. */
const ARTIFACT_MANIFEST = 'package/dsh-offline.json';
/** Package manifest inside the artifact. */
const ARTIFACT_PACKAGE_JSON = 'package/package.json';

/**
 * Read and validate an artifact without installing it.
 * @param artifact - absolute path to the `.tgz`.
 * @returns either `{ recognized: false, artifact }` for a foreign tarball, or
 *   `{ recognized: true, artifact, metadata, manifest, warnings }`.
 * @throws {OfflineError} for a missing, non-absolute or malformed artifact.
 */
export async function inspectArtifact(artifact, ctx) {
  const file = validateArtifactPath(artifact);
  const info = await statOf(file);
  const rawMetadata = await readTarGzTextEntry(file, ARTIFACT_MANIFEST);
  if (rawMetadata === null) {
    return { recognized: false, artifact: { file, bytes: info.size } };
  }
  let metadata;
  try {
    metadata = JSON.parse(rawMetadata);
  } catch (error) {
    throw new OfflineError('invalid-artifact', `The artifact's ${ARTIFACT_MANIFEST} is not valid JSON: ${String(error?.message ?? error)}`);
  }
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new OfflineError('invalid-artifact', `The artifact's ${ARTIFACT_MANIFEST} must hold one JSON object.`);
  }
  if (metadata.kind !== 'dsh-offline-plugin') {
    throw new OfflineError('invalid-artifact', `The artifact declares kind ${JSON.stringify(metadata.kind)} instead of "dsh-offline-plugin".`);
  }
  if (metadata.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new OfflineError(
      'unsupported-schema',
      `The artifact uses manifest schema ${JSON.stringify(metadata.schemaVersion)}; this plugin reads schema ${SUPPORTED_SCHEMA_VERSION}. Update dsh-plugin-offline.`,
    );
  }
  if (typeof metadata.plugin?.name !== 'string' || metadata.plugin.name === ''
    || typeof metadata.plugin?.version !== 'string' || metadata.plugin.version === '') {
    throw new OfflineError('invalid-artifact', 'The artifact manifest is missing plugin.name or plugin.version.');
  }

  const rawPackageJson = await readTarGzTextEntry(file, ARTIFACT_PACKAGE_JSON);
  if (rawPackageJson === null) {
    throw new OfflineError('invalid-artifact', `The artifact has no ${ARTIFACT_PACKAGE_JSON}.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(rawPackageJson);
  } catch (error) {
    throw new OfflineError('invalid-artifact', `The artifact's package.json is not valid JSON: ${String(error?.message ?? error)}`);
  }
  if (manifest?.name !== metadata.plugin.name || manifest?.version !== metadata.plugin.version) {
    throw new OfflineError(
      'manifest-mismatch',
      `The artifact's package.json names ${JSON.stringify(manifest?.name)}@${JSON.stringify(manifest?.version)} but its offline manifest names `
      + `${JSON.stringify(metadata.plugin.name)}@${JSON.stringify(metadata.plugin.version)}; refusing a tampered artifact.`,
    );
  }
  if (manifest?.dsh?.bundle?.patch === undefined) {
    throw new OfflineError(
      'not-a-bundle',
      `The artifact's package ${JSON.stringify(manifest.name)} declares no dsh.bundle.patch, so it cannot be selected as a profile bundle.`,
    );
  }

  const warnings = await targetWarnings(metadata.target, ctx);
  return { recognized: true, artifact: { file, bytes: info.size }, metadata, manifest, warnings };
}

/**
 * Install one offline artifact into the current profile.
 * @param options.ctx - Host plugin context (needs `pluginManager`).
 * @param options.artifact - absolute path to the `.tgz`.
 * @param options.enabled - whether to select the bundle (default true).
 * @returns a JSON-serializable summary including the manager's ChangeResult.
 * @throws {OfflineError} for a foreign/invalid artifact or a failed installation.
 */
export async function importArtifact({ ctx, artifact, enabled }) {
  const inspection = await inspectArtifact(artifact, ctx);
  if (!inspection.recognized) {
    throw new OfflineError(
      'not-offline-artifact',
      `${JSON.stringify(inspection.artifact.file)} has no package/dsh-offline.json, so it is not a dsh-plugin-offline artifact. `
      + 'Install an ordinary plugin tarball with plugin_manager { action: "install_bundle", target: <absolute .tgz path> }.',
    );
  }
  const manager = ctx?.pluginManager ?? ctx?.get?.('pluginManager');
  if (manager === undefined || manager === null) {
    throw new OfflineError('plugin-manager-unavailable', 'This profile has no pluginManager service, so the artifact cannot be installed.');
  }
  const warnings = [...inspection.warnings];
  if (inspection.metadata?.verification?.complete === false) {
    warnings.push(
      'The artifact\'s own completeness audit reported problems; some declared dependencies may be missing. '
      + 'Run plugin_offline action "verify" for details.',
    );
  }
  let install;
  try {
    install = await manager.installBundle(inspection.artifact.file, enabled === undefined ? {} : { enabled: Boolean(enabled) });
  } catch (error) {
    // A registry that the isolated network cannot reach must not block the
    // import: the artifact already carries the whole closure, so fall back to
    // materializing it without pnpm. Compatibility refusals and build-script
    // blocks are never bypassed.
    if (!isRegistryInstallFailure(error)) {
      throw new OfflineError(
        'install-failed',
        `Offline install of ${JSON.stringify(inspection.metadata.plugin.name)} failed: ${String(error?.message ?? error)}. `
        + 'The manager restored the profile manifest and lockfile; fix the reported cause and retry.',
        { cause: error },
      );
    }
    warnings.push(
      `The profile package manager could not resolve packages (${firstLine(error)}); `
      + 'the artifact was installed directly from its bundled files without pnpm. The profile lockfile is not updated by this fallback.',
    );
    install = await installWithoutPnpm({
      ctx,
      artifact: inspection.artifact.file,
      manifest: inspection.manifest,
      enabled: enabled === undefined ? true : Boolean(enabled),
    });
  }
  return {
    action: 'import',
    artifact: inspection.artifact.file,
    plugin: inspection.metadata.plugin,
    target: inspection.metadata.target ?? {},
    source: inspection.metadata.source ?? {},
    packages: Array.isArray(inspection.metadata.packages) ? inspection.metadata.packages.length : undefined,
    warnings,
    install,
  };
}

/**
 * Whether a manager installation failure is a registry/network problem that the
 * pnpm-free fallback may bypass. Compatibility refusals and blocked build
 * scripts stay authoritative and are never bypassed.
 * @param error - the rejection from `pluginManager.installBundle`.
 * @returns true for network, registry, authorization and offline kind failures.
 */
export function isRegistryInstallFailure(error) {
  const message = String(error?.message ?? error);
  if (/incompatible|version exemption|pendingBuild|blocked build|allowBuilds/i.test(message)) return false;
  return /ERR_PNPM_(?:FETCH|META_FETCH|OFFLINE|NO_OFFLINE|FETCH_404)|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network|registry|\b401\b|\b403\b|\b404\b/i.test(message);
}

/** First line of an error message, bounded for logs and warnings. */
function firstLine(error) {
  const text = String(error?.message ?? error).trim().split(/\r?\n/)[0];
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

/**
 * Install an artifact without the package manager: extract its `package/` tree
 * into `<profile>/node_modules/<name>` (the bundled nested `node_modules` already
 * holds the whole closure, so Node and DSH's runtime resolution find it), then
 * record the dependency and select the bundle in the profile manifest. Used only
 * when the package manager cannot reach a registry on an isolated machine.
 * @param options.ctx - Host plugin context (profile facts).
 * @param options.artifact - absolute artifact path.
 * @param options.manifest - the artifact's package manifest.
 * @param options.enabled - select the bundle layer (mirrors the manager option).
 * @returns a manager-shaped activation result with `manual: true`.
 */
async function installWithoutPnpm({ ctx, artifact, manifest, enabled }) {
  const profileDir = resolveProfileDir(ctx);
  const name = manifest?.name;
  if (typeof name !== 'string' || name === '') {
    throw new OfflineError('invalid-artifact', 'The artifact package.json has no package name.');
  }
  const manifestPath = join(profileDir, 'package.json');
  const originalManifest = await readFile(manifestPath, 'utf8');
  const targetDir = join(profileDir, 'node_modules', name);
  const staging = await mkdtemp(join(profileDir, '.dsh-offline-install-'));
  const tree = join(staging, 'package');
  let backup;
  let installed = false;
  let written = false;
  try {
    await extractTarGz({ file: artifact, destDir: tree });
    const extracted = readJsonFile(join(tree, 'package.json'));
    if (extracted?.name !== name) {
      throw new OfflineError('invalid-artifact', `Extracted package.json names ${JSON.stringify(extracted?.name)} instead of ${JSON.stringify(name)}.`);
    }
    if (extracted?.dsh?.bundle?.patch === undefined) {
      throw new OfflineError('not-a-bundle', `Extracted package ${JSON.stringify(name)} declares no dsh.bundle.patch.`);
    }
    await mkdir(dirname(targetDir), { recursive: true });
    if (existsSync(targetDir)) {
      backup = `${targetDir}.dsh-offline-backup-${Date.now()}`;
      await rename(targetDir, backup);
    }
    await rename(tree, targetDir);
    installed = true;
    const profileManifest = readJsonFile(manifestPath);
    profileManifest.dependencies = { ...(profileManifest.dependencies ?? {}), [name]: `file:${artifact}` };
    if (enabled !== false) {
      const dsh = { ...(profileManifest.dsh ?? {}) };
      const profile = { ...(dsh.profile ?? {}) };
      const bundles = Array.isArray(profile.bundles) ? profile.bundles.slice() : [];
      if (!bundles.includes(name)) bundles.push(name);
      profile.bundles = bundles;
      dsh.profile = profile;
      profileManifest.dsh = dsh;
    }
    await writeFileAtomic(manifestPath, `${JSON.stringify(profileManifest, undefined, 2)}\n`);
    written = true;
    if (backup !== undefined) {
      try {
        await rm(backup, { recursive: true, force: true });
      } catch {
        // A stale backup directory is harmless; the new install is in place.
      }
      backup = undefined;
    }
    return {
      stage: 'enable',
      target: name,
      enabled: enabled !== false,
      changed: true,
      application: 'applied',
      manual: true,
      bundle: name,
      ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
    };
  } catch (error) {
    if (installed) await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    if (backup !== undefined) await rename(backup, targetDir).catch(() => {});
    if (!written) await writeFile(manifestPath, originalManifest, 'utf8').catch(() => {});
    if (error instanceof OfflineError) throw error;
    throw new OfflineError(
      'install-failed',
      `Direct installation without pnpm failed: ${String(error?.message ?? error)}. The profile files were restored.`,
      { cause: error },
    );
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Replace one profile file atomically (same-directory temp + rename).
 * @param path - target file path.
 * @param content - UTF-8 text to write.
 */
async function writeFileAtomic(path, content) {
  const temp = join(dirname(path), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}

/**
 * Reject a non-path or missing artifact with an actionable message.
 * @param artifact - the caller-provided path.
 * @returns the absolute artifact path.
 */
function validateArtifactPath(artifact) {
  if (typeof artifact !== 'string' || artifact.trim() === '') {
    throw new OfflineError('invalid-artifact', 'artifact must be the absolute path of a .tgz produced by this plugin.');
  }
  const raw = artifact.trim();
  if (!isAbsolute(raw)) {
    throw new OfflineError('invalid-artifact', `artifact must be an absolute path, received ${JSON.stringify(raw)}.`);
  }
  if (!/\.(?:tgz|tar\.gz)$/i.test(raw)) {
    throw new OfflineError('invalid-artifact', `artifact must end in .tgz or .tar.gz, received ${JSON.stringify(raw)}.`);
  }
  return resolve(raw);
}

/**
 * Stat one artifact file with a dedicated error.
 * @param file - absolute artifact path.
 * @returns the file stats.
 */
async function statOf(file) {
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new OfflineError('artifact-not-found', `${JSON.stringify(file)} is not a regular file.`);
    return info;
  } catch (error) {
    if (error instanceof OfflineError) throw error;
    throw new OfflineError('artifact-not-found', `Cannot read artifact ${JSON.stringify(file)}: ${String(error?.message ?? error)}`);
  }
}

/**
 * Warnings for an artifact built for a different Host environment.
 * @param target - the artifact's target record.
 * @returns warning strings; empty when the host matches.
 */
async function targetWarnings(target, ctx) {
  const warnings = [];
  if (target === undefined || target === null || typeof target !== 'object') return warnings;
  if (typeof target.platform === 'string' && target.platform !== process.platform) {
    warnings.push(`Artifact was built for platform ${target.platform}, this Host runs ${process.platform}; native dependencies may not load.`);
  }
  if (typeof target.arch === 'string' && target.arch !== process.arch) {
    warnings.push(`Artifact was built for CPU ${target.arch}, this Host runs ${process.arch}; native dependencies may not load.`);
  }
  const runtime = await getRuntimeVersion(ctx);
  if (typeof target.dshVersion === 'string' && runtime !== undefined && target.dshVersion !== runtime) {
    warnings.push(
      `Artifact was built on DSH ${target.dshVersion}, this runtime is ${runtime}; `
      + 'the profile manager checks the plugin\'s DSH peer ranges and reports an exemption command if they refuse it.',
    );
  }
  return warnings;
}

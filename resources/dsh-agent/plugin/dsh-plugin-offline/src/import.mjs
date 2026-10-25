/**
 * Import pipeline: validate an offline artifact, then install it into the
 * current profile through the profile's own `pluginManager`, which persists the
 * dependency, selects the bundle layer and applies the live composition — with
 * no registry access because every dependency is bundled in the tarball.
 * @module dsh-plugin-offline/import
 */
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { readTarGzTextEntry } from './tar.mjs';
import { OfflineError, getRuntimeVersion } from './profile.mjs';

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
  let install;
  try {
    install = await manager.installBundle(inspection.artifact.file, enabled === undefined ? {} : { enabled: Boolean(enabled) });
  } catch (error) {
    throw new OfflineError(
      'install-failed',
      `Offline install of ${JSON.stringify(inspection.metadata.plugin.name)} failed: ${String(error?.message ?? error)}. `
      + 'The manager restored the profile manifest and lockfile; fix the reported cause and retry.',
      { cause: error },
    );
  }
  return {
    action: 'import',
    artifact: inspection.artifact.file,
    plugin: inspection.metadata.plugin,
    target: inspection.metadata.target ?? {},
    source: inspection.metadata.source ?? {},
    packages: Array.isArray(inspection.metadata.packages) ? inspection.metadata.packages.length : undefined,
    warnings: inspection.warnings,
    install,
  };
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

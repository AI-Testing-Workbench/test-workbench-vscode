/**
 * Artifact completeness audit.
 *
 * "Complete" means: starting from the plugin package, every declared runtime
 * dependency resolves inside the artifact's own `node_modules` (including the
 * nested copies created for version conflicts) or is supplied by the DSH
 * installation's runtime (`@deepseek-ai/*`). The walk also confirms the
 * `bundleDependencies` declarations match what is physically present, because
 * pnpm only installs what that field names.
 * @module dsh-plugin-offline/verify
 */
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { nodeModulePaths, readManifest, resolvePackageDir } from './closure.mjs';
import { extractTarGz } from './tar.mjs';
import { OfflineError } from './profile.mjs';

/** Marker file at the artifact package root. */
const ARTIFACT_MANIFEST = 'dsh-offline.json';

/**
 * Audit one extracted package root (the artifact's `package/` directory).
 * @param packageDir - extracted package root.
 * @returns the audit report; `ok` is false only for missing required pieces.
 */
export async function auditPackageDir(packageDir) {
  // Canonicalize once: `resolvePackageDir` returns realpaths, and on macOS the
  // temp dir can sit behind a /private symlink, which would make every bundled
  // copy look like it lived outside the artifact.
  let rootDir;
  try {
    rootDir = realpathSync(packageDir);
  } catch (error) {
    return failure(packageDir, `Cannot read the extracted package root: ${String(error?.message ?? error)}`);
  }
  const errors = [];
  const warnings = [];
  const runtimeProvided = new Set();
  const optionalMissing = [];
  const peersNotBundled = [];
  const nodes = new Map();

  let rootManifest;
  try {
    rootManifest = readManifest(rootDir);
  } catch (error) {
    return failure(join(rootDir, 'package.json'), `Cannot read the package manifest: ${String(error?.message ?? error)}`);
  }

  // 1. The artifact must still be a pluggable bundle.
  const patchDeclaration = rootManifest?.dsh?.bundle?.patch;
  const patchFiles = Array.isArray(patchDeclaration) ? patchDeclaration : patchDeclaration === undefined ? [] : [patchDeclaration];
  if (patchFiles.length === 0) {
    errors.push({ kind: 'missing-bundle-patch', packageName: rootManifest?.name, message: 'The package declares no dsh.bundle.patch.' });
  }
  for (const patchFile of patchFiles) {
    if (typeof patchFile !== 'string' || !existsSync(join(rootDir, patchFile))) {
      errors.push({ kind: 'missing-patch-file', packageName: rootManifest?.name, file: patchFile, message: `The bundle patch file ${JSON.stringify(patchFile)} is not inside the artifact.` });
    }
  }

  // 2. The offline marker should name the same package.
  const markerPath = join(rootDir, ARTIFACT_MANIFEST);
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8'));
      if (marker?.plugin?.name !== rootManifest?.name || marker?.plugin?.version !== rootManifest?.version) {
        errors.push({
          kind: 'marker-mismatch',
          packageName: rootManifest?.name,
          message: `The artifact manifest names ${JSON.stringify(marker?.plugin?.name)}@${JSON.stringify(marker?.plugin?.version)} but package.json names ${JSON.stringify(rootManifest?.name)}@${JSON.stringify(rootManifest?.version)}.`,
        });
      }
    } catch (error) {
      warnings.push(`The artifact manifest at ${ARTIFACT_MANIFEST} is unreadable: ${String(error?.message ?? error)}`);
    }
  }

  // 3. Walk the bundled dependency graph exactly like Node would.
  const queue = [{ dir: rootDir, manifest: rootManifest, requestedBy: undefined }];
  const visited = new Set();
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const dir = next.dir;
    if (visited.has(dir)) continue;
    visited.add(dir);
    const manifest = next.manifest;
    nodes.set(dir, {
      name: manifest?.name,
      version: manifest?.version,
      path: relative(rootDir, dir) === '' ? '.' : relative(rootDir, dir).split('\\').join('/'),
    });

    // 3a. Declared bundles must match physical node_modules entries.
    const declaredBundles = new Set(normalizeBundleList(manifest?.bundleDependencies));
    const actualBundles = listChildPackageNames(dir);
    for (const name of declaredBundles) {
      if (!actualBundles.has(name)) {
        errors.push({
          kind: 'declared-bundle-missing',
          packageName: manifest?.name,
          name,
          message: `${JSON.stringify(name)} is declared in bundleDependencies of ${JSON.stringify(manifest?.name)} but its files are not inside the artifact.`,
        });
      }
    }
    for (const name of actualBundles) {
      if (!declaredBundles.has(name)) {
        warnings.push(`${JSON.stringify(name)} sits in node_modules of ${JSON.stringify(manifest?.name)} without a bundleDependencies entry; pnpm may not install it.`);
      }
    }

    // 3b. Required, optional and peer dependencies.
    for (const [kind, record] of [['dependency', manifest?.dependencies], ['optional', manifest?.optionalDependencies]]) {
      for (const name of Object.keys(record ?? {})) {
        const resolved = resolveWithin(rootDir, name, dir);
        if (resolved !== undefined) {
          queue.push({ dir: resolved, manifest: readManifestSafe(resolved), requestedBy: manifest?.name });
          continue;
        }
        if (isRuntimeProvided(name)) {
          runtimeProvided.add(name);
          continue;
        }
        if (kind === 'optional') {
          optionalMissing.push({ name, requestedBy: manifest?.name });
          continue;
        }
        errors.push({
          kind: 'missing-dependency',
          packageName: manifest?.name,
          name,
          message: `${JSON.stringify(manifest?.name)} depends on ${JSON.stringify(name)} but no bundled copy exists.`,
        });
      }
    }

    const peerMeta = manifest?.peerDependenciesMeta ?? {};
    for (const name of Object.keys(manifest?.peerDependencies ?? {})) {
      const resolved = resolveWithin(rootDir, name, dir);
      if (resolved !== undefined) {
        queue.push({ dir: resolved, manifest: readManifestSafe(resolved), requestedBy: manifest?.name });
        continue;
      }
      if (isRuntimeProvided(name)) {
        runtimeProvided.add(name);
        continue;
      }
      if (peerMeta?.[name]?.optional === true) continue;
      peersNotBundled.push({ name, requestedBy: manifest?.name });
      warnings.push(`${JSON.stringify(name)} is a peer of ${JSON.stringify(manifest?.name)} and is neither bundled nor optional; another bundle or the runtime must provide it.`);
    }
  }

  // 4. Size summary and package list.
  const measured = await measure(rootDir);
  const packages = [...nodes.values()].map((node) => ({ name: node.name, version: node.version, path: node.path }));
  const report = {
    ok: errors.length === 0,
    complete: errors.length === 0,
    plugin: { name: rootManifest?.name, version: rootManifest?.version },
    packageCount: packages.length,
    packages,
    files: measured.files,
    bytes: measured.bytes,
    runtimeProvided: [...runtimeProvided].sort(),
    optionalMissing,
    peersNotBundled,
    errors,
    warnings,
  };
  return report;
}

/**
 * Audit one artifact file by extracting it into a temporary directory.
 * @param artifact - absolute `.tgz` path.
 * @returns the audit report plus artifact file facts.
 */
export async function verifyArtifact(artifact) {
  if (typeof artifact !== 'string' || artifact.trim() === '') {
    throw new OfflineError('invalid-artifact', 'artifact must be the absolute path of a .tgz produced by this plugin.');
  }
  const file = artifact.trim();
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new OfflineError('artifact-not-found', `Cannot read artifact ${JSON.stringify(file)}.`);
  }
  if (!info.isFile()) throw new OfflineError('artifact-not-found', `${JSON.stringify(file)} is not a regular file.`);
  const staging = await mkdtemp(join(tmpdir(), 'dsh-offline-verify-'));
  try {
    const packageDir = join(staging, 'package');
    await extractTarGz({ file, destDir: packageDir });
    const report = await auditPackageDir(packageDir);
    return { ...report, artifact: { file, bytes: info.size } };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** An unreadable package root becomes a one-error report. */
function failure(path, message) {
  return {
    ok: false,
    complete: false,
    plugin: {},
    packageCount: 0,
    packages: [],
    files: 0,
    bytes: 0,
    runtimeProvided: [],
    optionalMissing: [],
    peersNotBundled: [],
    errors: [{ kind: 'unreadable-package', path, message }],
    warnings: [],
  };
}

/** Normalize `bundleDependencies` (array or legacy object form) to a list. */
function normalizeBundleList(value) {
  if (Array.isArray(value)) return value.filter((name) => typeof name === 'string');
  if (value !== null && typeof value === 'object') return Object.keys(value).filter((name) => value[name]);
  return [];
}

/** Names of directories under `<dir>/node_modules` that hold a package.json. */
function listChildPackageNames(dir) {
  const names = new Set();
  const nodeModules = join(dir, 'node_modules');
  if (!existsSync(nodeModules)) return names;
  let entries;
  try {
    entries = readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      let scoped;
      try {
        scoped = readdirSync(join(nodeModules, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (child.isDirectory() && existsSync(join(nodeModules, entry.name, child.name, 'package.json'))) {
          names.add(`${entry.name}/${child.name}`);
        }
      }
    } else if (existsSync(join(nodeModules, entry.name, 'package.json'))) {
      names.add(entry.name);
    }
  }
  return names;
}

/** Resolve a dependency from `fromDir`, accepting only paths inside the artifact. */
function resolveWithin(rootDir, name, fromDir) {
  const resolved = resolvePackageDir(name, fromDir);
  if (resolved === undefined) return undefined;
  const rel = relative(rootDir, resolved);
  if (rel.startsWith('..') || rel === '') return undefined;
  // Only a real package directory counts (resolvePackageDir already probed package.json).
  return resolved;
}

/** The DSH installation supplies every `@deepseek-ai/*` package at runtime. */
function isRuntimeProvided(name) {
  return name.startsWith('@deepseek-ai/');
}

/** Read one manifest without throwing (a broken dependency manifest becomes a warning caller-side). */
function readManifestSafe(dir) {
  try {
    return readManifest(dir);
  } catch {
    return {};
  }
}

/** Count files and bytes below one directory. */
async function measure(dir) {
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
      const nested = await measure(path);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      try {
        const info = await stat(path);
        files += 1;
        bytes += info.size;
      } catch {
        // Vanished files add nothing.
      }
    }
  }
  return { files, bytes };
}

/**
 * dsh-plugin-offline — dependency resolution + closure collection + staging layout.
 *
 * The exporter is handed an installed package directory (for the desktop profile this is a
 * hoisted pnpm layout: `<profile>/node_modules/<name>` with dependencies as siblings). It walks
 * the dependency graph the same way Node does, then materializes a single npm package directory
 * (`<staging>/package/`) whose own files are copied and whose dependency closure is placed in
 * `package/node_modules/`. The staging directory is later packed as one tarball that declares
 * `bundleDependencies`; pnpm (hoisted linker) extracts the bundled node_modules nested inside the
 * installed plugin, which is exactly the layout DSH's runtime resolver wants.
 *
 * Only Node builtins are used and `src/tar.mjs` is deliberately not imported: this module knows
 * nothing about tar.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Packages supplied by the DSH installation itself must never be bundled. */
const RUNTIME_PROVIDED_PREFIX = '@deepseek-ai/';

/** Entry names that are never copied out of a package directory. */
const COPY_SKIPPED_NAMES = new Set(['node_modules', '.git', '.DS_Store']);

/** Guard against a symlinked package directory graph that never bottoms out. */
const MAX_COPY_DEPTH = 64;

/** Upper bound for the staged-resolution fixpoint loop (defensive only). */
const MAX_PLACEMENT_PASSES = 64;

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectKeys(value) {
  return isPlainObject(value) ? Object.keys(value) : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** package names are used as path segments, so refuse anything that could escape a node_modules dir. */
function isSafePackageName(name) {
  if (typeof name !== 'string' || name === '' || name.length > 214) return false;
  if (name.includes('\\') || name.includes('\0') || name.includes('//')) return false;
  const parts = name.split('/');
  if (parts.length > 2 || parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  if (parts.length === 2 && !parts[0].startsWith('@')) return false;
  return true;
}

function sameVersion(a, b) {
  return a !== undefined && b !== undefined && a === b;
}

/** Staged paths are always reported with forward slashes. */
function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function displayPath(target, packageDir) {
  const relative = path.relative(packageDir, target);
  return relative === '' ? '.' : toPosixPath(relative);
}

async function writeJsonFile(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

/** npm accepts an array, an object or `true` for bundleDependencies; normalize to a string list. */
function normalizeBundleList(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  if (isPlainObject(value)) return Object.keys(value);
  return [];
}

// ---------------------------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------------------------

/**
 * Node's node_modules lookup paths for modules resolved from `fromDir` (absolute, real).
 *
 * NODE_MODULES_PATHS: every ancestor of `fromDir`, deepest first, skipping a path segment that
 * is itself `node_modules`. This is what makes a package at `<x>/node_modules/<plugin>` resolve
 * its dependencies from `<x>/node_modules` instead of `<x>/node_modules/node_modules`.
 */
export function nodeModulePaths(fromDir) {
  const from = path.resolve(fromDir);
  const paths = [];
  let current = from;
  for (;;) {
    const base = path.basename(current);
    const isRoot = current === path.dirname(current);
    if (isRoot) {
      paths.push(path.join(current, 'node_modules'));
      break;
    }
    if (base !== '' && base !== 'node_modules') {
      paths.push(path.join(current, 'node_modules'));
    }
    current = path.dirname(current);
  }
  return paths;
}

/**
 * Probe Node's lookup order for a package directory. A package is a directory containing a
 * `package.json` file (an exports map is not needed for traversing the closure). The returned
 * directory is the realpath, so workspace symlinks resolve their dependencies from the real
 * location.
 */
export function resolvePackageDir(name, fromDir) {
  for (const searchPath of nodeModulePaths(fromDir)) {
    const candidate = path.join(searchPath, name);
    try {
      if (fs.statSync(path.join(candidate, 'package.json')).isFile()) {
        return fs.realpathSync(candidate);
      }
    } catch {
      // keep looking through the ancestor node_modules dirs
    }
  }
  return undefined;
}

/** Read and parse a package.json (the caller usually wants the raw object). */
export function readManifest(dir) {
  const file = path.join(dir, 'package.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (cause) {
    const error = new Error(`cannot read package manifest ${file}: ${cause.message}`, { cause });
    error.code = 'ENOMANIFEST';
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (cause) {
    const error = new Error(`invalid JSON in package manifest ${file}: ${cause.message}`, { cause });
    error.code = 'EINVALIDMANIFEST';
    throw error;
  }
  if (!isPlainObject(manifest)) {
    const error = new Error(`invalid package manifest ${file}: expected a JSON object`);
    error.code = 'EINVALIDMANIFEST';
    throw error;
  }
  return manifest;
}

// ---------------------------------------------------------------------------------------------
// closure collection
// ---------------------------------------------------------------------------------------------

/**
 * Walk the dependency graph of an installed package.
 *
 * Edges = dependencies ∪ optionalDependencies ∪ resolvable peerDependencies. The skip predicate
 * applies to every edge name (default: names starting with `@deepseek-ai/`, which the DSH runtime
 * provides and which must never be bundled). A missing optional dependency is only a warning; a
 * missing required dependency is recorded in `unresolved` (the staging step strips it from the
 * root manifest so a later offline install never asks the registry for it). Unresolvable peer
 * dependencies are simply not edges (`autoInstallPeers: false`).
 *
 * The walk is cycle safe: instances are keyed by realpath and a package that was already visited
 * is linked, never walked again.
 *
 * @param {{ rootPackageDir: string, skip?: (name: string) => boolean }} options
 * @returns {Promise<{
 *   root: { name: string, version: string, dir: string, manifest: object,
 *           edges: Array<{ name: string, kind: string, dir: string }> },
 *   instances: Map<string, { name: string, version: string, dir: string, manifest: object,
 *                            edges: Array<{ name: string, kind: string, dir: string }> }>,
 *   skipped: Array<{ name: string, requestedBy: string, kind: string }>,
 *   unresolved: Array<{ name: string, requestedBy: string, kind: string }>,
 *   warnings: string[]
 * }>}
 */
export async function collectDependencyClosure({ rootPackageDir, skip } = {}) {
  if (typeof rootPackageDir !== 'string' || rootPackageDir === '') {
    throw new TypeError('collectDependencyClosure: rootPackageDir is required');
  }
  const skipFn = typeof skip === 'function' ? skip : (name) => name.startsWith(RUNTIME_PROVIDED_PREFIX);
  const rootDir = await fsp.realpath(rootPackageDir);
  const rootManifest = readManifest(rootDir);
  const root = {
    name: typeof rootManifest.name === 'string' ? rootManifest.name : path.basename(rootDir),
    version: typeof rootManifest.version === 'string' ? rootManifest.version : '',
    dir: rootDir,
    manifest: rootManifest,
    edges: [],
  };

  const instances = new Map(); // realpath -> instance, insertion order = discovery order
  const skipped = [];
  const unresolved = [];
  const warnings = [];
  const skippedSeen = new Set();
  const unresolvedSeen = new Set();
  const warningSeen = new Set();
  const queue = [root]; // BFS: discovery order == insertion order of `instances`

  const warn = (message) => {
    if (warningSeen.has(message)) return;
    warningSeen.add(message);
    warnings.push(message);
  };
  const recordSkipped = (entry) => {
    const key = `${entry.requestedBy}\u0000${entry.name}\u0000${entry.kind}`;
    if (skippedSeen.has(key)) return;
    skippedSeen.add(key);
    skipped.push(entry);
  };
  const recordUnresolved = (entry) => {
    const key = `${entry.requestedBy}\u0000${entry.name}\u0000${entry.kind}`;
    if (unresolvedSeen.has(key)) return;
    unresolvedSeen.add(key);
    unresolved.push(entry);
  };

  const addInstance = (dir) => {
    const existing = instances.get(dir);
    if (existing) return existing;
    const manifest = readManifest(dir);
    const instance = {
      name: typeof manifest.name === 'string' ? manifest.name : path.basename(dir),
      version: typeof manifest.version === 'string' ? manifest.version : '',
      dir,
      manifest,
      edges: [],
    };
    instances.set(dir, instance);
    queue.push(instance);
    return instance;
  };

  let cursor = 0;
  while (cursor < queue.length) {
    const node = queue[cursor];
    cursor += 1;
    const label = `${node.name}@${node.version || '0.0.0'}`;
    const requestedBy = node.name;

    // Dependencies first, optional dependencies override a same-name required dependency
    // (npm semantics: an entry in optionalDependencies wins over one in dependencies).
    const declared = new Map();
    for (const name of objectKeys(node.manifest.dependencies)) declared.set(name, 'dependency');
    for (const name of objectKeys(node.manifest.optionalDependencies)) declared.set(name, 'optional');

    for (const [name, kind] of declared) {
      if (!isSafePackageName(name)) {
        recordUnresolved({ name, requestedBy, kind });
        warn(`${label} declares an invalid dependency name ${JSON.stringify(name)}; it cannot be bundled`);
        continue;
      }
      if (skipFn(name)) {
        recordSkipped({ name, requestedBy, kind });
        continue;
      }
      const dir = resolvePackageDir(name, node.dir);
      if (!dir) {
        if (kind === 'optional') {
          warn(`optional dependency "${name}" of ${label} is not installed; it is skipped`);
        } else {
          recordUnresolved({ name, requestedBy, kind });
          warn(
            `required dependency "${name}" of ${label} could not be resolved; ` +
              'it will be removed from the staged package',
          );
        }
        continue;
      }
      addInstance(dir);
      node.edges.push({ name, kind, dir });
    }

    // Peers only participate when they are resolvable from this package (autoInstallPeers: false
    // means an unresolvable peer is a normal, expected situation; it does not need warning noise).
    for (const name of objectKeys(node.manifest.peerDependencies)) {
      if (declared.has(name)) continue;
      if (!isSafePackageName(name)) continue;
      const dir = resolvePackageDir(name, node.dir);
      if (!dir) continue;
      if (skipFn(name)) {
        recordSkipped({ name, requestedBy, kind: 'peer' });
        continue;
      }
      addInstance(dir);
      node.edges.push({ name, kind: 'peer', dir });
    }
  }

  return { root, instances, skipped, unresolved, warnings };
}

// ---------------------------------------------------------------------------------------------
// staging
// ---------------------------------------------------------------------------------------------

async function copyPackageFiles(sourceDir, destDir, state) {
  let sourceReal;
  try {
    sourceReal = await fsp.realpath(sourceDir);
  } catch (cause) {
    throw new Error(`cannot copy package ${sourceDir}: ${cause.message}`, { cause });
  }
  await fsp.mkdir(destDir, { recursive: true });
  await copyDirectoryContents(sourceReal, destDir, state, new Set([sourceReal]), 0);
}

async function copyDirectoryContents(sourceDir, destDir, state, ancestors, depth) {
  if (depth > MAX_COPY_DEPTH) {
    state.warn(`copy depth limit (${MAX_COPY_DEPTH}) reached inside ${sourceDir}; the rest is skipped`);
    return;
  }
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const name = entry.name;
    if (COPY_SKIPPED_NAMES.has(name)) continue;
    const sourcePath = path.join(sourceDir, name);
    const destPath = path.join(destDir, name);
    let stat;
    try {
      stat = await fsp.stat(sourcePath); // follows symlinks on purpose: bundled files are real files
    } catch (cause) {
      if (cause && (cause.code === 'ENOENT' || cause.code === 'ELOOP')) {
        state.warn(`skipped dangling symlink ${sourcePath}`);
        continue;
      }
      throw cause;
    }
    if (stat.isDirectory()) {
      const real = await fsp.realpath(sourcePath);
      if (ancestors.has(real)) {
        state.warn(`symlink cycle skipped while copying ${sourcePath} (points back to ${real})`);
        continue;
      }
      if (entry.isSymbolicLink() && real.split(path.sep).includes('node_modules')) {
        state.warn(`skipped symlink ${sourcePath}: it points into node_modules`);
        continue;
      }
      ancestors.add(real);
      await fsp.mkdir(destPath, { recursive: true });
      await copyDirectoryContents(real, destPath, state, ancestors, depth + 1);
      ancestors.delete(real);
    } else if (stat.isFile()) {
      if (name.endsWith('.tgz')) continue; // stale tarballs are never package content
      await fsp.copyFile(sourcePath, destPath);
      try {
        await fsp.chmod(destPath, stat.mode & 0o777);
      } catch {
        // mode restoration is best effort (e.g. exotic filesystems)
      }
      state.bytes += stat.size;
      state.files += 1;
    } else {
      state.warn(`skipped unsupported file type at ${sourcePath}`);
    }
  }
}

/**
 * First-come-first-served placement of every closure instance.
 *
 * The first requester of an instance determines where it goes: flat under `package/node_modules/`
 * when the slot is free (or already holds the same version, in which case the physical copy is
 * shared), otherwise nested under the declaring package (whose bundleDependencies are updated
 * later). Instances are keyed by realpath, so the walk never places the same physical package
 * twice except for the resolution fallback in `enforceResolvablePlacements`.
 */
function placeInstances(closure, packageDir, copies, copiesByPath, placementByInstanceDir) {
  const rootDir = closure.root.dir;
  const firstRequester = new Map(); // instance dir -> { requesterDir, kind }
  for (const edge of closure.root.edges ?? []) {
    firstRequester.set(edge.dir, { requesterDir: rootDir, kind: edge.kind });
  }
  for (const instance of closure.instances.values()) {
    for (const edge of instance.edges ?? []) {
      if (!firstRequester.has(edge.dir)) firstRequester.set(edge.dir, { requesterDir: instance.dir, kind: edge.kind });
    }
  }

  const flatByName = new Map();
  for (const instance of closure.instances.values()) {
    if (placementByInstanceDir.has(instance.dir)) continue; // shared with an already placed copy
    const name = instance.name;
    const request = firstRequester.get(instance.dir);
    if (!request) {
      throw new Error(`staging: dependency "${name}" (${instance.dir}) was never requested`);
    }
    const parentCopy = request.requesterDir === rootDir ? undefined : placementByInstanceDir.get(request.requesterDir);
    if (request.requesterDir !== rootDir && !parentCopy) {
      // Discovery order guarantees a parent is placed before its children; this is a bug guard.
      throw new Error(`staging: parent of dependency "${name}" was not placed yet`);
    }
    const parentAbs = parentCopy ? parentCopy.absDir : packageDir;
    const flat = flatByName.get(name);

    if (flat) {
      if (sameVersion(flat.version, instance.version)) {
        placementByInstanceDir.set(instance.dir, flat);
        continue;
      }
      const absDir = path.join(parentAbs, 'node_modules', name);
      const copy = { name, version: instance.version, kind: request.kind, instance, absDir, parentAbs };
      copies.push(copy);
      copiesByPath.set(absDir, copy);
      placementByInstanceDir.set(instance.dir, copy);
      continue;
    }

    const absDir = path.join(packageDir, 'node_modules', name);
    const copy = { name, version: instance.version, kind: request.kind, instance, absDir, parentAbs: null };
    copies.push(copy);
    copiesByPath.set(absDir, copy);
    flatByName.set(name, copy);
    placementByInstanceDir.set(instance.dir, copy);
  }
}

/** Resolve `name` from a staged directory using Node semantics, restricted to the staged tree. */
function resolveStagedCopy(requesterStagedDir, name, packageDir, copiesByPath) {
  for (const searchPath of nodeModulePaths(requesterStagedDir)) {
    const relative = path.relative(packageDir, path.resolve(searchPath));
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const candidate = path.join(searchPath, name);
    const copy = copiesByPath.get(candidate);
    if (copy) return copy;
  }
  return undefined;
}

/**
 * Guard the staging layout against hoisting decisions that would make a nested package resolve a
 * different version than the one it asked for at its source location (possible when a package that
 * was physically flat is nested under a bundle owner that carries its own nested copies). A local
 * copy under the requester is added only when the staged lookup would otherwise be wrong, so the
 * common hoisted case never pays for this.
 */
function enforceResolvablePlacements({ closure, packageDir, copies, copiesByPath, placementByInstanceDir, warn }) {
  const nodes = [closure.root, ...closure.instances.values()];
  const stagedDirOf = (node) =>
    node === closure.root ? packageDir : placementByInstanceDir.get(node.dir)?.absDir;

  for (let pass = 0; pass <= MAX_PLACEMENT_PASSES; pass += 1) {
    let added = 0;
    let unfixable = 0;
    for (const node of nodes) {
      const requesterStaged = stagedDirOf(node);
      if (!requesterStaged) continue;
      for (const edge of node.edges ?? []) {
        const target = placementByInstanceDir.get(edge.dir);
        if (!target) continue;
        const resolved = resolveStagedCopy(requesterStaged, edge.name, packageDir, copiesByPath);
        const ok =
          resolved &&
          (resolved.instance.dir === edge.dir ||
            (target.version !== undefined && sameVersion(resolved.version, target.version)));
        if (ok) continue;

        const localPath = path.join(requesterStaged, 'node_modules', edge.name);
        const existing = copiesByPath.get(localPath);
        if (existing) {
          if (
            existing.instance.dir === edge.dir ||
            (target.version !== undefined && sameVersion(existing.version, target.version))
          ) {
            continue;
          }
          unfixable += 1;
          continue;
        }
        const copy = {
          name: edge.name,
          version: target.version,
          kind: edge.kind,
          instance: target.instance,
          absDir: localPath,
          parentAbs: requesterStaged,
        };
        copies.push(copy);
        copiesByPath.set(localPath, copy);
        warn(
          `staged copy of "${edge.name}"@${target.version} for ${node.name} is shadowed; ` +
            `nested an extra copy under ${displayPath(requesterStaged, packageDir)} to keep it resolvable`,
        );
        added += 1;
      }
    }
    if (added === 0) {
      if (unfixable > 0) {
        warn(`${unfixable} dependency edge(s) still resolve to a different version in the staged tree`);
      }
      return;
    }
  }
  warn('staged dependency placement did not reach a fixpoint; some nested resolutions may be wrong');
}

/**
 * Remove from the staged root `dependencies` every declared dependency that is neither placed in
 * the artifact nor deliberately skipped as runtime-provided. A leftover declaration would make the
 * later offline pnpm install try to resolve it against the registry. Optional dependencies are left
 * intact: a missing optional dependency is legal and pnpm does not fail the install for it.
 */
function stripUnplacedRootDependencies(rootManifest, closure) {
  const removed = [];
  if (!isPlainObject(rootManifest.dependencies)) return removed;
  // Without edge information (a hand-built closure) there is no way to know what was placed, so
  // leave the manifest alone rather than stripping everything.
  if (!Array.isArray(closure.root.edges)) return removed;
  const placed = new Set(closure.root.edges.map((edge) => edge.name));
  const skipped = new Set(
    (closure.skipped ?? [])
      .filter((entry) => entry && entry.requestedBy === closure.root.name)
      .map((entry) => entry.name),
  );
  for (const name of Object.keys(rootManifest.dependencies)) {
    if (placed.has(name) || skipped.has(name)) continue;
    delete rootManifest.dependencies[name];
    removed.push({ name, reason: 'not resolvable from the source profile' });
  }
  return removed;
}

function placementsResult(copies, packageDir) {
  return copies.map((copy) => ({
    name: copy.name,
    version: copy.version,
    path: toPosixPath(path.relative(packageDir, copy.absDir)),
    kind: copy.kind,
  }));
}

function addOwnerBundle(ownerBundles, ownerAbs, name) {
  let names = ownerBundles.get(ownerAbs);
  if (!names) {
    names = [];
    ownerBundles.set(ownerAbs, names);
  }
  if (!names.includes(name)) names.push(name);
}

async function writeGeneratedFiles(packageDir, generatedFiles) {
  if (!isPlainObject(generatedFiles)) return;
  for (const [relative, content] of Object.entries(generatedFiles)) {
    if (typeof relative !== 'string' || relative === '') {
      throw new TypeError('generatedFiles keys must be non-empty relative paths');
    }
    const normalized = relative.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
      throw new Error(`generatedFiles: absolute path ${JSON.stringify(relative)} is not allowed`);
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`generatedFiles: unsafe path ${JSON.stringify(relative)}`);
    }
    const dest = path.join(packageDir, ...segments);
    let data;
    if (typeof content === 'string' || Buffer.isBuffer(content) || content instanceof Uint8Array) {
      data = content;
    } else {
      data = `${JSON.stringify(content, null, 2)}\n`;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data);
  }
}

/**
 * Materialize the closure under `<stagingDir>/package/`.
 *
 * The caller creates `stagingDir` empty and may delete it afterwards. Root package files are
 * copied from `closure.root.dir` (excluding node_modules/.git/.DS_Store/*.tgz); the modified root
 * package.json is written over the copied one with 2-space JSON and a trailing newline.
 *
 * @param {{
 *   closure: Awaited<ReturnType<typeof collectDependencyClosure>>,
 *   stagingDir: string,
 *   generatedFiles?: Record<string, string|object>,
 *   packageJsonTransform?: (manifest: object, stage: object) => object|void|Promise<object|void>,
 * }} options
 * @returns {Promise<{
 *   packageDir: string,
 *   bundleDependencies: string[],
 *   placements: Array<{ name: string, version: string, path: string, kind: string }>,
 *   removedDependencies: Array<{ name: string, reason: string }>,
 *   copiedBytes: number,
 *   fileCount: number,
 *   warnings: string[],
 * }>}
 */
export async function stageBundledPackage({ closure, stagingDir, generatedFiles = {}, packageJsonTransform } = {}) {
  if (!closure || typeof closure !== 'object' || !closure.root || !(closure.instances instanceof Map)) {
    throw new TypeError('stageBundledPackage: a closure from collectDependencyClosure is required');
  }
  if (typeof stagingDir !== 'string' || stagingDir === '') {
    throw new TypeError('stageBundledPackage: stagingDir is required');
  }

  const warnings = [];
  const warningSeen = new Set();
  for (const warning of Array.isArray(closure.warnings) ? closure.warnings : []) {
    if (typeof warning !== 'string' || warningSeen.has(warning)) continue;
    warningSeen.add(warning);
    warnings.push(warning);
  }
  const warn = (message) => {
    if (warningSeen.has(message)) return;
    warningSeen.add(message);
    warnings.push(message);
  };

  const stagingRoot = path.resolve(stagingDir);
  const packageDir = path.join(stagingRoot, 'package');
  await fsp.mkdir(packageDir, { recursive: true });

  const copyState = { bytes: 0, files: 0, warn };

  // 1. The plugin's own files (package.json is rewritten below).
  await copyPackageFiles(closure.root.dir, packageDir, copyState);

  // 2. Dependency placement (no I/O yet: paths only).
  const copies = [];
  const copiesByPath = new Map();
  const placementByInstanceDir = new Map();
  placeInstances(closure, packageDir, copies, copiesByPath, placementByInstanceDir);
  enforceResolvablePlacements({
    closure,
    packageDir,
    copies,
    copiesByPath,
    placementByInstanceDir,
    warn,
  });

  // 3. Copy each placed dependency's own files next to the plugin files.
  for (const copy of copies) {
    await copyPackageFiles(copy.instance.dir, copy.absDir, copyState);
  }

  // 4. Root manifest: merged bundleDependencies, stripped unplaced dependencies, transform.
  const ownerBundles = new Map(); // staged owner dir -> names placed directly under its node_modules
  const flatNames = [];
  for (const copy of copies) {
    if (copy.parentAbs === null || copy.parentAbs === packageDir) {
      if (!flatNames.includes(copy.name)) flatNames.push(copy.name);
    } else {
      addOwnerBundle(ownerBundles, copy.parentAbs, copy.name);
    }
  }

  const rootManifest = JSON.parse(JSON.stringify(closure.root.manifest));
  const removedDependencies = stripUnplacedRootDependencies(rootManifest, closure);
  const rootBundle = uniqueStrings([...normalizeBundleList(rootManifest.bundleDependencies), ...flatNames]);
  if (rootBundle.length > 0 || rootManifest.bundleDependencies !== undefined) {
    rootManifest.bundleDependencies = rootBundle;
  }

  const placementList = placementsResult(copies, packageDir);
  const stageInfo = {
    stagingDir: stagingRoot,
    packageDir,
    bundleDependencies: rootBundle,
    placements: placementList,
    removedDependencies,
  };
  let manifest = rootManifest;
  if (typeof packageJsonTransform === 'function') {
    const transformed = await packageJsonTransform(rootManifest, stageInfo);
    if (transformed !== undefined && transformed !== null) manifest = transformed;
  }
  if (!isPlainObject(manifest)) {
    throw new TypeError('packageJsonTransform must return a package.json object (or mutate and return undefined)');
  }
  await writeJsonFile(path.join(packageDir, 'package.json'), manifest);

  // 5. Every nested bundle owner declares its newly nested packages.
  for (const [ownerAbs, names] of ownerBundles) {
    const ownerManifest = await readJsonFile(path.join(ownerAbs, 'package.json'));
    ownerManifest.bundleDependencies = uniqueStrings([
      ...normalizeBundleList(ownerManifest.bundleDependencies),
      ...names,
    ]);
    await writeJsonFile(path.join(ownerAbs, 'package.json'), ownerManifest);
  }

  // 6. Generated files (e.g. dsh-offline.json) live at the package root.
  await writeGeneratedFiles(packageDir, generatedFiles);

  return {
    packageDir,
    bundleDependencies: Array.isArray(manifest.bundleDependencies)
      ? manifest.bundleDependencies.slice()
      : rootBundle.slice(),
    placements: placementList,
    removedDependencies,
    copiedBytes: copyState.bytes,
    fileCount: copyState.files,
    warnings,
  };
}

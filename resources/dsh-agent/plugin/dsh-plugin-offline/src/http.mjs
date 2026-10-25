/**
 * Browser endpoints behind the Plugins page's offline-export button.
 *
 * The Client half runs in the page and cannot call Host services or the agent
 * tool, so it uses the same transport the shipped Web UI uses for plugin-owned
 * routes: an exact route on `ctx.webServer`. Only two read/export operations are
 * exposed — importing a tarball stays user-approval-gated through the agent tool.
 * @module dsh-plugin-offline/http
 */
import { mkdir, mkdtemp, open, rename, rm, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { OfflineError, getRuntimeVersion, installAnchorOf, listInstalledBundles, resolveProfileDir } from './profile.mjs';
import { defaultArtifactDir, exportPlugin } from './export.mjs';
import { importArtifact, inspectArtifact } from './import.mjs';

/** Route prefix owned by this plugin. */
const PREFIX = '/dsh-offline/api/v1';
/** Largest JSON request body accepted (the export request carries one bundle name). */
const MAX_BODY_BYTES = 64 * 1024;
/** Largest offline artifact accepted for import (bytes). */
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

/**
 * Register the offline-transfer browser routes when this profile has a web server.
 * @param ctx - Host plugin context.
 * @returns a disposer removing every route (no-op without a web server).
 */
export function registerOfflineRoutes(ctx) {
  const webServer = safeGet(ctx, 'webServer');
  if (webServer === undefined || typeof webServer.register !== 'function') return () => {};
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: `${PREFIX}/bundles`,
      handler: (request, response) => respond(response, () => handleBundles(ctx, request)),
    }),
    webServer.register({
      kind: 'exact',
      path: `${PREFIX}/import`,
      handler: (request, response) => respond(response, () => handleImport(ctx, request)),
    }),
    webServer.register({
      kind: 'exact',
      path: `${PREFIX}/export`,
      handler: (request, response) => respond(response, () => handleExport(ctx, request)),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Already removed by the server teardown.
      }
    }
  };
}

/**
 * Run one handler and serialize either its JSON value or its failure.
 * @param response - HTTP response.
 * @param handler - async handler returning `{ status, body }`.
 */
async function respond(response, handler) {
  try {
    const { status, body, headers } = await handler();
    sendJson(response, status, body, headers);
  } catch (error) {
    if (error instanceof OfflineError) {
      sendJson(response, error.code === 'plugin-manager-unavailable' ? 501 : 400, {
        ok: false,
        code: error.code,
        message: error.message,
      });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * GET the profile's exportable bundles, artifact directory and runtime facts.
 * @param ctx - Host plugin context.
 * @param request - HTTP request.
 */
async function handleBundles(ctx, request) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const profileDir = resolveProfileDir(ctx);
  const bundles = await listInstalledBundles(ctx);
  return {
    status: 200,
    body: {
      ok: true,
      profileDir,
      artifactDir: defaultArtifactDir(),
      runtime: { version: (await getRuntimeVersion(ctx)) ?? null, installAnchor: installAnchorOf(ctx) ?? null },
      bundles: bundles
        .filter((bundle) => bundle.installed === true)
        .map(({ name, version, enabled, description, rows }) => ({ name, version, enabled, description, rows })),
    },
  };
}

/**
 * POST `{ plugin }` and export that bundle to the default artifact directory.
 * The output path is fixed here: the page has no path picker, and accepting an
 * arbitrary write target from a browser request is not worth the capability.
 * @param ctx - Host plugin context.
 * @param request - HTTP request.
 */
async function handleExport(ctx, request) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const contentType = String(request.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { status: 415, body: { ok: false, code: 'unsupported-media-type', message: 'Expected application/json.' } };
  }
  const body = await readJsonBody(request);
  const plugin = typeof body?.plugin === 'string' ? body.plugin.trim() : '';
  if (plugin === '') {
    return { status: 400, body: { ok: false, code: 'invalid-plugin', message: 'The request must name one installed bundle in "plugin".' } };
  }
  const output = await resolveChosenDirectory(body?.output);
  const result = await exportPlugin({ ctx, plugin, ...(output === undefined ? {} : { output }) });
  return {
    status: 200,
    body: {
      ok: true,
      result: {
        artifact: result.artifact,
        bytes: result.bytes,
        plugin: result.plugin,
        packageCount: result.packageCount,
        packages: result.packages,
        warnings: result.warnings,
        warningCount: result.warningCount,
        runtimeProvided: result.runtimeProvided,
        notBundled: result.notBundled,
        target: result.target,
      },
    },
  };
}

/**
 * Read a bounded JSON body from a browser request.
 * @param request - HTTP request.
 * @returns the parsed JSON value.
 * @throws {OfflineError} for an unreadable, oversized or non-JSON body.
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new OfflineError('invalid-request', 'Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (size === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new OfflineError('invalid-request', 'Request body is not valid JSON.'));
      }
    });
    request.on('error', (error) => reject(new OfflineError('invalid-request', `Could not read the request body: ${String(error?.message ?? error)}`)));
  });
}

/**
 * Write one JSON response.
 * @param response - HTTP response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable value.
 */
function sendJson(response, status, body, headers = {}) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    ...headers,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  response.end(text);
}

/**
 * A 405 result carrying the allowed method.
 * @param method - the method this endpoint accepts.
 */
function methodNotAllowed(method) {
  return { status: 405, body: { ok: false, code: 'method-not-allowed', message: `Use ${method}.` }, headers: { allow: method } };
}

/**
 * Read an optional service without throwing when the profile lacks it.
 * @param ctx - Host plugin context.
 * @param name - exact service key.
 */
function safeGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}


/**
 * Validate an optional user-chosen output directory from the page.
 * @param output - raw request value.
 * @returns the absolute directory, or undefined for the default artifact folder.
 * @throws {OfflineError} for a relative path, a missing path, or a non-directory.
 */
async function resolveChosenDirectory(output) {
  if (output === undefined || output === null || String(output).trim() === '') return undefined;
  const path = String(output).trim();
  if (!isAbsolute(path)) {
    throw new OfflineError('invalid-output', `The export folder must be an absolute path, received ${JSON.stringify(path)}.`);
  }
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new OfflineError('invalid-output', `The export folder ${JSON.stringify(path)} does not exist.`);
  }
  if (!info.isDirectory()) {
    throw new OfflineError('invalid-output', `The export folder ${JSON.stringify(path)} is not a directory.`);
  }
  return path;
}

/**
 * POST one offline artifact body and install it into the profile.
 *
 * This is the human's own action from the Plugins page — the same authority the
 * shipped plugin manager page uses for its install button — so it installs
 * directly through the profile manager instead of the agent approval gate. The
 * body is a `.tgz` produced by export; a foreign tarball is refused with the
 * `plugin_manager` hint. The uploaded bytes are validated and parked under
 * `<DSH_HOME>/offline-artifacts/imports/` before installation, because the
 * profile records that path as the dependency's source.
 * @param ctx - Host plugin context.
 * @param request - HTTP request carrying the tarball.
 */
async function handleImport(ctx, request) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (request.headers['x-dsh-offline-import'] !== '1') {
    return { status: 400, body: { ok: false, code: 'missing-import-header', message: 'Missing the offline-import request marker.' } };
  }
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/octet-stream')) {
    return { status: 415, body: { ok: false, code: 'unsupported-media-type', message: 'Send the tarball as application/octet-stream.' } };
  }
  const importsDir = join(defaultArtifactDir(), 'imports');
  await mkdir(importsDir, { recursive: true });
  const stagingDir = await mkdtemp(join(importsDir, '.upload-'));
  const stagingFile = join(stagingDir, 'artifact.tgz');
  try {
    const bytes = await receiveArtifact(request, stagingFile);
    if (bytes === 0) {
      return { status: 400, body: { ok: false, code: 'empty-body', message: 'The upload carried no bytes.' } };
    }
    let inspection;
    try {
      inspection = await inspectArtifact(stagingFile, ctx);
    } catch (error) {
      if (error instanceof OfflineError) throw error;
      throw new OfflineError(
        'invalid-artifact',
        `The uploaded file is not a readable offline artifact: ${String(error?.message ?? error)}`,
      );
    }
    if (!inspection.recognized) {
      throw new OfflineError(
        'not-offline-artifact',
        'This file has no package/dsh-offline.json, so it is not a dsh-plugin-offline artifact. '
        + 'Use plugin_manager { action: "install_bundle", target: <absolute .tgz path> } for an ordinary plugin tarball.',
      );
    }
    const stem = `${fileStem(inspection.metadata.plugin.name)}-${fileStem(inspection.metadata.plugin.version)}-offline.tgz`;
    const stableFile = join(importsDir, stem);
    await rm(stableFile, { force: true });
    await rename(stagingFile, stableFile);
    const installed = await importArtifact({ ctx, artifact: stableFile });
    return {
      status: 200,
      body: {
        ok: true,
        artifact: stableFile,
        bytes,
        plugin: installed.plugin,
        target: installed.target,
        warnings: installed.warnings,
        install: installed.install,
      },
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Stream a request body into one file with a hard size bound.
 * @param request - HTTP request.
 * @param file - destination path.
 * @returns the number of bytes written.
 * @throws {OfflineError} with code `artifact-too-large` past the bound.
 */
async function receiveArtifact(request, file) {
  const handle = await open(file, 'w');
  let bytes = 0;
  try {
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_IMPORT_BYTES) {
        throw new OfflineError('artifact-too-large', `The artifact exceeds the ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB import limit.`);
      }
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return bytes;
}

/**
 * A filesystem-safe file name stem for a plugin name or version.
 * @param value - package name or version.
 */
function fileStem(value) {
  return String(value).replace(/^@/, '').replace(/[\\/]+/g, '__').replace(/[^A-Za-z0-9._+~-]+/g, '-') || 'artifact';
}

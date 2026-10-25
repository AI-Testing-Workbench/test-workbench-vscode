/**
 * The model-facing `plugin_offline` tool: one action-keyed entry point over the
 * export, import, list and inspect pipelines.
 * @module dsh-plugin-offline/tool
 */
import { exportPlugin, defaultArtifactDir, resolveArtifactPath } from './export.mjs';
import { importArtifact, inspectArtifact } from './import.mjs';
import { OfflineError, getRuntimeVersion, installAnchorOf, listInstalledBundles, resolveProfileDir } from './profile.mjs';

/** Tool name registered on the Host tool registry. */
export const TOOL_NAME = 'plugin_offline';

/**
 * Build the tool definition for one Host context.
 * @param ctx - Host plugin context (exposes `tools`, `pluginManager`).
 * @returns a `ToolDefinition` ready for `ctx.tools.register`.
 */
export function createOfflineTool(ctx) {
  return {
    name: TOOL_NAME,
    description:
      'Move DSH plugins between a networked machine and an isolated machine. '
      + 'action "list" shows the current profile\'s installed bundles that can be exported. '
      + 'action "export" packs one installed bundle and its whole dependency closure into a single .tgz artifact that can be installed with no registry access (optionally copy it to a path with "output"; the default is <DSH_HOME>/offline-artifacts). '
      + 'action "inspect" reads an artifact\'s offline manifest, bundle rows, target DSH version and bundled packages without installing it. '
      + 'action "import" installs an artifact into the current profile offline through the profile plugin manager, selecting the bundle like a normal install; it needs danger-full-access or approval because installed Host code runs outside the workspace sandbox and the change persists across sessions. '
      + 'The artifact remains the installed dependency\'s source path: keep it where it was imported from. '
      + 'Artifacts are platform/arch specific for native modules and carry the DSH runtime version they were built on.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'export', 'inspect', 'import'],
          description:
            'list = installed exportable bundles; export = pack one bundle into an offline artifact; '
            + 'inspect = read an artifact without installing; import = install an artifact into this profile offline.',
        },
        plugin: {
          type: 'string',
          description: 'For action "export": the exact installed bundle name returned by action "list".',
        },
        output: {
          type: 'string',
          description:
            'For action "export": optional absolute path for the artifact — either a .tgz file or a directory. '
            + 'Defaults to <DSH_HOME>/offline-artifacts/<name>-<version>-offline.tgz.',
        },
        artifact: {
          type: 'string',
          description: 'For actions "inspect" and "import": the absolute path of a .tgz produced by action "export".',
        },
        enabled: {
          type: 'boolean',
          description: 'For action "import": select the installed bundle layer in the profile (default true).',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args, exec) {
      return dispatch(ctx, args, exec);
    },
    presentCall: (args) => {
      switch (args?.action) {
        case 'export':
          return { card: 'generic', title: `Export plugin ${args?.plugin ?? ''} offline`, kind: 'execute' };
        case 'import':
          return { card: 'generic', title: `Import offline plugin ${args?.artifact ?? ''}`, kind: 'execute' };
        case 'inspect':
          return { card: 'generic', title: `Inspect offline artifact ${args?.artifact ?? ''}`, kind: 'read' };
        default:
          return { card: 'generic', title: 'List exportable plugins', kind: 'read' };
      }
    },
  };
}

/**
 * Route one accepted call to its pipeline and serialize the result.
 * @param ctx - Host plugin context.
 * @param args - losslessly snapshotted model arguments.
 * @param exec - tool execution identity, cancellation signal, and agent.
 * @returns the canonical JSON string result.
 */
async function dispatch(ctx, args, exec) {
  switch (args?.action) {
    case 'list': {
      const profileDir = resolveProfileDir(ctx);
      const bundles = await listInstalledBundles(ctx);
      const exportable = bundles.filter((bundle) => bundle.installed === true);
      return JSON.stringify({
        action: 'list',
        profileDir,
        artifactDir: defaultArtifactDir(),
        runtime: { version: (await getRuntimeVersion(ctx)) ?? null, installAnchor: installAnchorOf(ctx) ?? null },
        exportable,
        notExportable: {
          count: bundles.length - exportable.length,
          reason: 'Bundles supplied by the DSH installation have no profile package to pack; only bundles installed into this profile can be exported.',
        },
        hint: 'Pass one exportable bundle name to action "export". A disabled bundle can still be exported.',
      });
    }
    case 'export': {
      if (args.plugin === undefined) throw new OfflineError('invalid-plugin', 'action "export" requires "plugin" (a name from action "list").');
      const result = await exportPlugin({ ctx, plugin: args.plugin, output: args.output });
      return JSON.stringify(result);
    }
    case 'inspect': {
      if (args.artifact === undefined) throw new OfflineError('invalid-artifact', 'action "inspect" requires "artifact" (an absolute .tgz path).');
      const result = await inspectArtifact(args.artifact, ctx);
      return JSON.stringify({
        action: 'inspect',
        ...result,
        ...(result.recognized
          ? { installable: true, artifactPathForImport: result.artifact.file }
          : {
              installable: false,
              hint: 'This file is not a dsh-plugin-offline artifact. Install an ordinary plugin tarball with plugin_manager { action: "install_bundle", target: <absolute .tgz path> }.',
            }),
      });
    }
    case 'import': {
      if (args.artifact === undefined) throw new OfflineError('invalid-artifact', 'action "import" requires "artifact" (an absolute .tgz path).');
      await requireProfileMutationApproval(ctx, exec, args);
      const result = await importArtifact({ ctx, artifact: args.artifact, enabled: args.enabled });
      return JSON.stringify(result);
    }
    default:
      throw new OfflineError('invalid-action', `Unknown action ${JSON.stringify(args?.action)}; use one of "list", "export", "inspect", "import".`);
  }
}

/**
 * Gate a profile mutation the same way `plugin_manager` does: skip the prompt
 * only under danger-full-access, otherwise ask once through the approval
 * service (which itself applies the session's ask/never policy).
 * @param ctx - Host plugin context.
 * @param exec - the running tool execution.
 * @param args - accepted arguments, for the justification text.
 * @throws {OfflineError} when approval is unavailable, refused or cancelled.
 */
async function requireProfileMutationApproval(ctx, exec, args) {
  const sandboxPolicy = safeGet(ctx, 'sandboxPolicy');
  let mode;
  try {
    mode = sandboxPolicy?.resolve?.(exec?.agent === undefined ? {} : { session: exec.agent.session })?.mode;
  } catch {
    mode = undefined;
  }
  if (mode === 'danger-full-access') return;
  const approval = safeGet(ctx, 'approval');
  if (approval === undefined || typeof approval.request !== 'function') {
    throw new OfflineError(
      'approval-unavailable',
      'Importing an offline plugin changes the profile and needs approval, but this Host exposes no approval service. '
      + 'Run the session with danger-full-access permission to install it.',
    );
  }
  if (exec?.agent === undefined) {
    throw new OfflineError(
      'approval-unavailable',
      'Importing an offline plugin changes the profile and needs an agent-scoped approval; this call has no agent. '
      + 'Run the session with danger-full-access permission to install it.',
    );
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: TOOL_NAME,
    callId: exec.callId,
    reason:
      `plugin_offline import ${JSON.stringify(args.artifact)} installs Host code from a local tarball into the current profile. `
      + 'Profile changes persist across sessions and installed Host code runs outside the workspace sandbox.',
    signal: exec.signal,
  });
  if (outcome !== 'allowed-once') {
    throw new OfflineError('approval-refused', `Offline import was not approved (${String(outcome)}).`);
  }
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

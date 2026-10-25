/**
 * dsh-plugin-offline — move an installed DSH plugin between a networked machine
 * and an isolated one.
 *
 * Export packs the selected profile bundle plus its whole dependency closure
 * into one npm tarball whose `bundleDependencies` make pnpm install it with no
 * registry access; import installs that tarball back through the profile
 * plugin manager, which persists the dependency, selects the bundle layer and
 * applies the live composition. See docs/DESIGN.md for the verified pnpm/DSH
 * mechanics behind both directions.
 *
 * The agent reaches both directions through the `plugin_offline` tool; the Web
 * Plugins page reaches export through routes registered on the profile's own
 * web server (see `src/http.mjs` and `client.js`).
 */
import { registerOfflineRoutes } from './src/http.mjs';
import { createOfflineTool } from './src/tool.mjs';

export const name = 'dsh-plugin-offline';

/** The tool registry and the profile plugin manager are both required. */
export const inject = ['tools', 'pluginManager'];

/**
 * Register the model-facing offline transfer tool and, when this profile serves
 * the Web UI, the routes behind its export button.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.tools.register(createOfflineTool(ctx)),
    'dsh-plugin-offline: plugin_offline tool',
  );
  // The web server is optional (headless and SDK profiles have none), so wait
  // for the service instead of reading it during apply. A child fiber also
  // registers the routes when the service loads after this plugin.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => registerOfflineRoutes(webCtx),
      'dsh-plugin-offline: browser export routes',
    );
  });
}

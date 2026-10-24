# dsh Agent runtime (packaged)

This directory is populated at packaging time by
`scripts/dsh-agent/prepare-runtime.mjs`. Nothing here is committed except this
document and the client plugin source.

```text
resources/dsh-agent/
  node/
    bin/node                 # Node 22.22.1 (node.exe on Windows)
  app/
    node_modules/            # pinned dsh plus its hoisted dependencies
  web/
    index.html               # dsh web frontend dist (diagnostics/offline page)
  host/
    README.md                # notes on dsh-desktop-host (optional)
  plugin/
    dsh-client-tscode/       # dsh client plugin (source, installed into the profile)
  VERSION                    # dsh version / node version / format / build time
  THIRD_PARTY_NOTICES
  runtime.json               # version pin enforced by prepare-runtime
  previous/                  # optional rollback snapshot (never shipped)
```

At packaging time `gulpfile.vscode.ts` copies this directory to the app root,
so the installed path is `<appRoot>/resources/dsh-agent` (on macOS
`Contents/Resources/app/resources/dsh-agent`).

## Why Node is bundled separately

Electron 39.8.7 carries a different Node build than dsh expects. The Host runs
under the staged Node 22.22.1 process so native modules (`koffi`, `node-pty`,
`sharp`, `flock`) see the runtime they were built for.

## Staging

```bash
# --dsh must be inside a dedicated npm prefix, not a global node_modules tree:
npm install --prefix .build/dsh-runtime --no-save --no-package-lock @deepseek-ai/dsh@0.2.0-rc.2
node scripts/dsh-agent/prepare-runtime.mjs \
  --dsh .build/dsh-runtime/node_modules/@deepseek-ai/dsh \
  --node "$(which node)" \
  --keep-previous
node scripts/dsh-agent/prepare-runtime.mjs --check
node scripts/dsh-agent/e2e-smoke.mjs
node scripts/dsh-agent/size-report.mjs
```

`--keep-previous` snapshots the current `app/node`, `app/web`, and plugin
payload under `previous/`. `node scripts/dsh-agent/rollback-runtime.mjs` swaps
them back. Normal release rollback also works by reinstalling the previous app
build, because the runtime ships inside the application.

## Development

Without staged resources, the Agent resolves `node` and `dsh` from `PATH` (Node
22.22.1 + the globally installed `dsh`). This is the default for `./scripts/code.sh`.

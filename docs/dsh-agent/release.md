# Release pipeline notes (dsh Agent)

The packaged app resolves the runtime at:

```text
<appRoot>/resources/dsh-agent/
  node/bin/node        # node.exe on Windows
  app/node_modules/    # pinned dsh + hoisted dependencies
  web/                 # dsh-web-frontend dist
  plugin/              # dsh-client-tscode (source)
  VERSION
```

`<appRoot>` is the repository root in development and
`<App>.app/Contents/Resources/app` (macOS) or `resources/app` (Windows/Linux)
after packaging.

## Required steps

Every platform job must stage the runtime **before** the gulp packaging step:

```bash
npm install --prefix .build/dsh-runtime --no-save --no-package-lock \
  "@deepseek-ai/dsh@${DSH_AGENT_VERSION}"
node scripts/dsh-agent/prepare-runtime.mjs \
  --dsh .build/dsh-runtime/node_modules/@deepseek-ai/dsh \
  --node "$(which node)"
node scripts/dsh-agent/prepare-runtime.mjs --check
node scripts/dsh-agent/e2e-smoke.mjs
```

The version is pinned twice and both must match:

- `.github/workflows/release*.yml`: `DSH_AGENT_VERSION`
- `resources/dsh-agent/runtime.json`: `{ "dsh": "...", "node": "..." }`

`prepare-runtime` rejects a mismatch, so a dsh upgrade now requires an explicit
commit to the pin and a green smoke run.

After packaging, verify the runtime survived the gulp/Electron copy:

```bash
RUNTIME=$(find ../VSCode-darwin-arm64 \
  -path '*/Contents/Resources/app/resources/dsh-agent/VERSION' -print -quit)
node scripts/dsh-agent/prepare-runtime.mjs --check --out "$(dirname "$RUNTIME")"
```

Windows uses `Get-ChildItem -Recurse -Filter VERSION` because the app folder is
under `resources/app`.

## Current workflow changes

- `release.yml`: Windows x64, macOS arm64, and Linux x64 jobs install, stage,
  smoke, and verify the runtime.
- `release-darwin-x64.yml`: same for macOS x64 with `npm_config_arch=x64`.
- `.build/dsh-runtime` is cached by platform/arch + dsh version. The first run
  downloads the dsh dependency tree (~500 MB); later runs restore it.
- `gulpfile.vscode.ts` copies `resources/dsh-agent/**` (without `previous/`)
  into the app root and preserves the executable bit on Node.
- On Windows, `patchWin32DependenciesTask` skips `*/resources/dsh-agent/**`:
  the runtime carries Mach-O/ELF `.node` prebuilds for other platforms and
  `rcedit` only understands PE files.
- `dshAgentPreload.js` is listed in `vscodeResourceIncludes`, so
  `core-ci` → package includes it.

## Signing and installers

- The copied `node` binary, native Node modules under `app/node_modules`, and
  the dsh CLI are inside the app bundle. A hardened-runtime/notarized build
  must deep-sign them (or sign every Mach-O under
  `Contents/Resources/app/resources/dsh-agent`).
- Windows code signing should cover `node.exe` and native `.node` files if the
  installer is signed per-file.
- The runtime adds roughly 500 MB installed (dsh dependencies + Node) and is
  outside `node_modules.asar`. `npm run dsh-agent:size` reports the staged
  payload. Platform/arch trimming is a follow-up (plan E8).

## Caveats

- The public npm registry must be reachable from the runner. If an internal
  mirror is required, add `--registry=...` to the `npm install` step.
- The macOS x64 workflow runs on an Intel runner (`macos-15-intel`). A staged
  Node binary and dsh native modules for x64 cannot be executed on an arm64
  runner without Rosetta, and the smoke/`--check` steps run them. If that label
  is unavailable, build the x64 runtime in a separate Intel job and pass its
  artifact to the packaging job instead of cross-staging on arm64.
- Set `npm_config_arch` explicitly on cross-arch builds so optional native
  dependencies match the target.
- Node 24.18.0 ships npm 11, which may print `allow-scripts` warnings for dsh's
  native packages. The runtime uses bundled N-API prebuilds, so the staged
  smoke and `node-pty` still work (verified 2026-10-24). If a future dependency
  needs a postinstall build, approve that script explicitly in the install step.
- Linux is beta. The bundled Node 24.18.0 binary tops out at `GLIBC_2.28`, but
  dsh's speech dependency `sherpa-onnx-linux-x64` (1.13.8) requires
  `GLIBC_2.32` / `GLIBCXX_3.4.29`. The VS Code glibc gate therefore skips
  `*/resources/dsh-agent/*`; the runtime is validated by `prepare-runtime
  --check` and the smoke test instead. On a glibc < 2.32 host the core agent
  still runs, but speech-to-text may fail to load. Re-check both baselines when
  the dsh or Node pin changes.
- `resources/dsh-agent/previous` is a local rollback snapshot and is excluded
  from packages.

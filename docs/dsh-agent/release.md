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

The runtime comes from tarballs packed by the dsh fork. The fork workflow
`tscode-runtime.yml` builds and uploads them on every push to `dev`, and can be
run manually on any branch. The tscode `dsh-runtime` job resolves the artifact
in this order:

1. the exact fork workflow run id passed by the trigger (`dsh_fork_run_id`);
2. latest successful `tscode-runtime.yml` run on `dsh_fork_ref` (default
   `dev`);
3. a source build from `dsh_fork_ref` when no artifact is available.

The fork workflow triggers tscode after the artifact is uploaded. The tscode
workflow never triggers the fork; it only pulls the artifact (or builds from
source as a fallback).

It then uploads the tarballs as a tscode workflow artifact, and every platform
job downloads that artifact and resolves its own native dependencies while
installing.

```bash
node scripts/dsh-agent/install-runtime-from-tarballs.mts \
  --out .build/dsh-runtime \
  --from .build/dsh-tarballs/dsh \
  --from .build/dsh-tarballs/vendor \
  --from .build/dsh-tarballs/landlock
node scripts/dsh-agent/prepare-runtime.mjs \
  --dsh .build/dsh-runtime/node_modules/@deepseek-ai/dsh \
  --node "$(which node)" \
  --dsh-version <artifact version> \
  --fork-ref <artifact commit>
node scripts/dsh-agent/prepare-runtime.mjs --check \
  --dsh-version <artifact version> \
  --fork-ref <artifact commit>
node scripts/dsh-agent/e2e-smoke.mjs
```

`--dsh-version` / `--fork-ref` let CI validate the artifact that was actually
resolved. Without them, `prepare-runtime` falls back to the local pin in
`resources/dsh-agent/runtime.json`.

### Manual tscode builds

`release.yml` and `release-darwin-x64.yml` expose these `workflow_dispatch`
inputs:

| Input | Default | Purpose |
| --- | --- | --- |
| `dsh_fork_repository` | `AI-Testing-Workbench/testagent-dsh` | fork repository |
| `dsh_fork_ref` | `dev` | fork branch used to find the latest artifact |
| `dsh_fork_run_id` | empty | exact fork workflow run; set automatically by the fork trigger, leave empty for the latest branch artifact |

### Fork build and tscode trigger

The fork's `.github/workflows/tscode-runtime.yml` runs on pushes to `dev` and
manual dispatches. It builds and packs the runtime, uploads the
`dsh-fork-tarballs` artifact (30-day retention), and then triggers tscode's
release workflow with the exact fork run id and branch.

The tscode workflow only pulls the artifact; it never triggers the fork.

Required secrets:

- fork repository: `TSCODE_DISPATCH_TOKEN`, a token that may run workflows in
  the tscode repository (fine-grained: Actions write; classic: `repo`);
- tscode repository: `DSH_FORK_TOKEN`, a token that may read fork Actions
  artifacts (fine-grained: Actions read; classic: `repo`).

The fork's own artifact upload uses `GITHUB_TOKEN`. If `DSH_FORK_TOKEN` is
missing or cannot read the artifact, tscode falls back to a source build of
`dsh_fork_ref`.

### Integration builds for a feature branch

1. Push the fork branch, or run **tscode runtime** manually on that branch.
   The fork workflow triggers tscode with that exact run id.
2. Alternatively, run the tscode release workflow manually with
   `dsh_fork_ref=<fork branch>` and leave `dsh_fork_run_id` empty; tscode pulls
   the latest successful artifact from that branch.

After packaging, verify the runtime survived the gulp/Electron copy:

```bash
RUNTIME=$(find ../VSCode-darwin-arm64 \
  -path '*/Contents/Resources/app/resources/dsh-agent/VERSION' -print -quit)
node scripts/dsh-agent/prepare-runtime.mjs --check --out "$(dirname "$RUNTIME")" \
  --dsh-version <artifact version> --fork-ref <artifact commit>
```

Windows uses `Get-ChildItem -Recurse -Filter VERSION` because the app folder is
under `resources/app`.

## Current workflow changes

- `release.yml` and `release-darwin-x64.yml` start with a `dsh-runtime` job that
  downloads the latest successful `tscode-runtime.yml` artifact on
  `dsh_fork_ref` and falls back to `build:official` + packing when no artifact is
  available.
- Windows x64, macOS arm64/x64, and Linux x64 jobs download that artifact,
  install the runtime from the tarballs, stage, smoke, and verify it.
- `.build/dsh-runtime` is cached by platform/arch + fork revision. The first run
  installs the dependency tree (~900 MB); later runs restore it.
- The install must not use `--omit=optional`: `koffi` resolves its platform
  binary through an optional dependency, and omitting it falls back to a source
  build that needs CMake.
- npm 11.16 treats install scripts as opt-in. The installer generates an
  `allowScripts` policy for `koffi`, `node-pty`, and the packed dsh packages
  that need one, so the profile postinstall still runs.
- `gulpfile.vscode.ts` copies `resources/dsh-agent/**` (without `previous/`)
  into the app root and preserves the executable bit on Node.
- On Windows, `patchWin32DependenciesTask` skips `*/resources/dsh-agent/**`:
  the runtime carries Mach-O/ELF `.node` prebuilds for other platforms and
  `rcedit` only understands PE files.
- The gulp copy keeps dotfiles (`filter(..., { dot: true })`). `pi-ai` imports
  `dist/providers/data/.manifest.json`; dropping it makes `dsh-llm-pi-ai` fail
  to import and the Models settings surface logs `failed to import`.
  `prepare-runtime --check` verifies the manifest in the packaged app.
- `dshAgentPreload.js` is listed in `vscodeResourceIncludes`, so
  `core-ci` → package includes it.

## Signing and installers

- The copied `node` binary, native Node modules under `app/node_modules`, and
  the dsh CLI are inside the app bundle. A hardened-runtime/notarized build
  must deep-sign them (or sign every Mach-O under
  `Contents/Resources/app/resources/dsh-agent`).
- Windows code signing should cover `node.exe` and native `.node` files if the
  installer is signed per-file.
- The runtime adds roughly 1 GB installed (dsh dependencies + Node) and is
  outside `node_modules.asar`. `npm run dsh-agent:size` reports the staged
  payload. Platform/arch trimming is a follow-up (plan E8).

## Caveats

- The dsh fork repository must be readable by the release runner. It is public
  today; if it becomes private, add a read token to the checkout step.
- External runtime dependencies still come from the public npm registry. If an
  internal mirror is required, set `npm_config_registry` for the installer.
- If the fork changes `native/system`, its platform tarballs must be built and
  added to the `landlock` pack output. Otherwise `@deepseek-ai/node-addon-system`
  is resolved from the registry like any other external dependency.
- The macOS x64 workflow runs on an Intel runner (`macos-15-intel`). A staged
  Node binary and dsh native modules for x64 cannot be executed on an arm64
  runner without Rosetta, and the smoke/`--check` steps run them. If that label
  is unavailable, build the x64 runtime in a separate Intel job and pass its
  artifact to the packaging job instead of cross-staging on arm64.
- Set `npm_config_arch` explicitly on cross-arch builds so optional native
  dependencies match the target.
- Node 24.18.0 ships npm 11.16, which treats install scripts as opt-in. The
  installer writes the `allowScripts` policy into the generated manifest; do not
  replace it with `--dangerously-allow-all-scripts`.
- The runtime includes the pnpm version pinned in `runtime.json`. The
  `.build/dsh-runtime` cache key is versioned (`dsh-agent-runtime-v3-*`); bump it
  whenever the installer gains a new non-dsh package so a stale cache cannot
  skip the install step.
- Linux is beta. The bundled Node 24.18.0 binary tops out at `GLIBC_2.28`, but
  dsh's speech dependency `sherpa-onnx-linux-x64` (1.13.8) requires
  `GLIBC_2.32` / `GLIBCXX_3.4.29`. The VS Code glibc gate therefore skips
  `*/resources/dsh-agent/*`; the runtime is validated by `prepare-runtime
  --check` and the smoke test instead. On a glibc < 2.32 host the core agent
  still runs, but speech-to-text may fail to load. Re-check both baselines when
  the dsh or Node pin changes.
- `resources/dsh-agent/previous` is a local rollback snapshot and is excluded
  from packages.

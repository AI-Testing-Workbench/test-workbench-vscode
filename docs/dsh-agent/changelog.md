# dsh Agent changelog

This file records changes to the dsh Agent integration. Code changes follow the
repository's `test-workbench_change` marker convention; this file is the
human-readable counterpart.

## 2026-10-29 — Deduplicate the runtime dependency tree

- 63 dsh packages pin `zod` exactly to `4.4.3`, while a few transitive caret
  ranges resolved `4.6.7` at the install root. npm could not hoist the exact
  pin, so every dependent received its own copy: 55 extra copies, ~352 MB and
  40,330 files in the shipped runtime (62% of all files).
- `runtime.json` now has a `dedupe` list. `install-runtime-from-tarballs.mts`
  turns it into npm `overrides`, but only when every packed exact pin agrees on
  one version; disagreeing pins log a warning and keep npm's default layout.
- Reinstalled from the same fork tarballs on macOS arm64: `node_modules`
  906 MB → 569 MB, files 65,186 → 30,088, `@deepseek-ai` 601 MB → 267 MB, one
  zod copy (4.4.3). `e2e-smoke.mjs` passes against the deduplicated runtime
  (Host ready 829 ms, plugin bundle, WS mux, session preset, traversal, profile).

## 2026-10-26 — Fix Windows install failure from long runtime paths

- Windows still enforces the 260-character `MAX_PATH` limit during setup. The
  optional `@deepseek-ai/dsh-experimental-inspector` package ships Chrome
  DevTools issue descriptions with file names up to 121 characters; under
  `resources/dsh-agent/app/node_modules/...` those paths exceeded the limit and
  broke installation.
- `install-runtime-from-tarballs.mts` now removes the inspector's
  `lib/devtools/models/issues_manager/descriptions` directory after `npm
  install`, and `prepare-runtime.mjs` filters it out while staging.
- `prepare-runtime.mjs --check` now rejects Windows runtimes with any path over
  140 characters under `app/node_modules`, so a future dependency cannot
  silently reintroduce the failure.
- The inspector is an optional bundle that the `web` profile never mounts; only
  its DevTools issue descriptions are unavailable.

## 2026-10-25 — Fix clipboard and context menu in the dsh window

- The dsh Agent window is a plain `BrowserWindow` without a workbench renderer,
  so the application Edit menu commands were sent to the IDE renderer and did
  nothing. `Cmd/Ctrl+C/X/V/A` are now handled in the window's
  `before-input-event` hook.
- Added a native `context-menu` handler with Cut/Copy/Paste/
  Paste and Match Style/Select All, plus Open Link/Copy Link for links.
- The menubar's Edit commands now fall back to the focused web contents when
  the focused window has no workbench renderer, so menu clicks work too.
- Verified in the dev app: pasting Chinese text into the dsh composer, selecting
  all and copying back to the system clipboard, and right-clicking the composer
  (menu contains cut/copy/paste/pasteAndMatchStyle/selectAll).

## 2026-10-25 — Fix the dsh “add workspace” no-op

- `DshAgentIpcChannel.PickDirectory` now always opens the IDE's native folder
  dialog, using the current IDE workspace as `defaultPath`. It no longer returns
  the IDE root directly.
- The old fast path made the dsh sidebar's “add workspace” button appear dead
  once the IDE root was already a dsh workspace: `createWorkspace` received the
  existing path and the UI closed without a visible change.
- Cancelling the dialog still returns `null`, which dsh treats as a cancelled
  pick. Selecting any folder creates a normal dsh workspace and starts a session
  in it.
- Verified in the dev app with an isolated `DSH_HOME`: the click now logs
  `[dshAgent] opening native directory picker` and opens the native sheet
  instead of silently returning the existing root.

## 2026-10-25 — Bundle pnpm for the embedded plugin manager

- `resources/dsh-agent/runtime.json` now pins `pnpm` 11.28.8.
- `install-runtime-from-tarballs.mts` installs the pinned pnpm package next to
  dsh in the runtime prefix and verifies its version.
- `prepare-runtime.mjs` stages a `pnpm` shim next to the bundled Node
  (`node/bin/pnpm`, or `node/pnpm.cmd` on Windows) and verifies that it runs.
  The Host already prepends that directory to `PATH`, so dsh's plugin manager no
  longer fails with `spawn pnpm ENOENT` in packaged builds.
- Runtime cache keys move from `v2` to `v3` so every platform reinstalls the
  closure instead of restoring a cache without pnpm.
- `e2e-smoke.mjs` prints and validates the bundled pnpm version when present.
- Verified on macOS arm64 with a PATH that excludes every global pnpm:
  installed `dsh-better-sidebar` 0.28.0 through the dsh plugin page, enabled it,
  and confirmed its file/task/side-chat tabs appeared in the right sidebar.

## 2026-10-25 — Fix new-session failure with dsh 0.2.1 presets

- Stopped disabling `plugin-manager` / `tool-plugin-manager` in the managed
  profile patch. The shipped `standard` preset mounts
  `@deepseek-ai/dsh-plugin-manager/tools`, so every new session failed with
  `SessionCreateError: session create failed: agent-preset/invalid:
  tool-plugin-manager (@deepseek-ai/dsh-plugin-manager/tools): waiting for
  pluginManager`.
- The existing managed block is rewritten on the next launch, so installations
  with the old patch recover without deleting `~/.tscode-dsh`.
- Restored the full native dsh plugin extension model:
  `ui-plugin-manager`, `ui-settings-plugins`, `plugin-inventory`,
  `ui-settings-plugin-inventory`, `plugin-package-inventory-deepseek`, and
  `hmr` all stay enabled, and so do the agent presets that mount the
  management tools. `DSH_AGENT_DISABLED_PLUGINS` is now empty; the managed patch
  block is removed and the file is left as `[]` when it has no user rows. The
  agent-facing `plugin_manager` tool still requires an explicit
  `danger-full-access` approval per call.
- `e2e-smoke.mjs` now creates an agent session and asserts the `standard`
  preset resolves; this is the regression test for the failure.
- Updated `docs/dsh-agent/security.md` and the plan's permission table to match
  the enforced profile.

## 2026-10-25 — Fork-driven integration builds

- Fork: added `.github/workflows/tscode-runtime.yml`. A push to `dev` (or a
  manual run on any branch) builds and packs the runtime, uploads the
  `dsh-fork-tarballs` artifact, and triggers tscode's release workflow with the
  exact run id and branch.
- Tscode: `release.yml` and `release-darwin-x64.yml` expose
  `dsh_fork_repository`, `dsh_fork_ref` (default `dev`), and
  `dsh_fork_run_id` (set automatically by the fork trigger) inputs.
- The tscode `dsh-runtime` job pulls the artifact for the requested run, or the
  latest successful fork `tscode-runtime.yml` artifact on the selected branch.
  If neither is available it falls back to a source build. Tscode never triggers
  the fork.
- `prepare-runtime.mjs` accepts `--dsh-version` and `--fork-ref` so CI can
  validate the resolved artifact instead of the local `runtime.json` pin.
- Runtime caches are keyed by the resolved fork commit, not the configured
  branch.
- `install-runtime-from-tarballs.mts` now keeps optional-only dsh packages in
  `optionalDependencies`. This prevents npm on Windows/Linux from failing with
  `EBADPLATFORM` on `@deepseek-ai/dsh-experimental-cua-macos`.
- Required secrets: fork `TSCODE_DISPATCH_TOKEN` (trigger tscode) and tscode
  `DSH_FORK_TOKEN` (read fork artifacts). See `docs/dsh-agent/release.md`.

## 2026-10-25 — Switch the runtime source to the dsh fork

- `resources/dsh-agent/runtime.json` now pins dsh `0.2.1-rc.3` and the fork
  revision (`AI-Testing-Workbench/testagent-dsh`). `prepare-runtime.mjs`
  records the revision in `VERSION` and verifies it during `--check`.
- Added `scripts/dsh-agent/install-runtime-from-tarballs.mts`:
  - installs the dependency closure of `@deepseek-ai/dsh` from packed tarballs;
  - verifies an optional `manifest.json` / `SHA256SUMS`;
  - generates an npm 11 `allowScripts` policy (file tarballs need their exact
    `file://` URL);
  - does not omit optional dependencies, because `koffi` resolves its platform
    binary through one.
- `release.yml` and `release-darwin-x64.yml` now build the fork once per run,
  pack the `dsh` / `vendor` / `landlock` families, share them as an artifact,
  and install from those tarballs in each platform job. Runtime caches are keyed
  by fork revision instead of the dsh version.
- Verified on macOS arm64 with Node 24.18.0:
  - fork `build:official` and all three `release:pack` runs succeed;
  - the closure installer stages 322 dsh packages (640 packages total);
  - `prepare-runtime` staging and `--check` pass;
  - `e2e-smoke.mjs` passes against the staged runtime with the bundled Node.

## 2026-10-25 — Windows drive-letter module duplication (welcome notice save)

- `src/vs/platform/dshAgent/node/dshAgentPaths.ts`: normalize the Windows drive
  letter (for example `c:` → `C:`) on the runtime entry, Node executable,
  `DSH_HOME`, and log directory before spawning the Host.
- Root cause: the packaged app exposed `appRoot` with a lowercase drive while
  `os.homedir()` returned an uppercase one. Node module URLs keep that case, so
  dsh loaded `@deepseek-ai/dsh-app-boot` twice (`file:///c:/...` vs
  `file:///C:/...`). `ConfigEditor` then read a different `bootstrapIncludes`
  WeakMap and rejected every settings write with
  `dsh: profile reload requires the root Include entry`; the welcome notice
  displayed `暂时无法保存确认状态，请重试。`.
- Verified on Windows x64 against the installed runtime: a lowercase entry plus
  an uppercase home reproduces the rejection; normalizing both makes
  `settings/mutate` return `ok` and the preview notice stays dismissed after a
  reload.
- Added unit coverage in `src/vs/platform/dshAgent/test/node/dshAgentPaths.test.ts`.
- `src/vs/platform/dshAgent/electron-main/dshAgentWindow.ts`: forward renderer
  `console-message` output to the main log as `[dshAgent:renderer]` (errors and
  warnings at their levels, other chatter at trace), inject an
  `unhandledrejection` listener on every document load, and log structured
  `settings/mutate|update|replace` failures (`{ result: { ok: false } }`) that
  dsh otherwise only renders as a generic message. This makes swallowed UI
  failures visible without attaching DevTools.

## 2026-10-24 — Package dsh dotfiles (pi-ai import fix)

- `build/gulpfile.vscode.ts`: the dsh runtime copy now filters with
  `{ dot: true }`. The previous filter dropped
  `@earendil-works/pi-ai/dist/providers/data/.manifest.json`, so the packaged
  app logged `llm-pi-ai (...): failed to import` and the Models settings surface
  could not save the preview-notice acknowledgement.
- `scripts/dsh-agent/prepare-runtime.mjs --check`: fails when the pi-ai package
  is staged but its `.manifest.json` is missing, so packaging regressions are
  caught before an installer is uploaded.

## 2026-10-24 — Trae Agent window research (docs only)

- Added `docs/dsh-agent/trae-agent-window-research-and-plan.md`:
  - Trae Agent Solo Lite window entry, bootstrap, React + workbench services,
    and the service/UI boundary.
  - Correction: Trae shares VS Code's service layer and extension host, not its
    visible terminal/explorer/editor components.
  - tscode + dsh comparison, key conclusions, P0/P1/P2 evolution plan, metrics,
    risks, and open questions.
- No runtime or code changes in this entry.

## 2026-10-24 — Node 24.18.0 runtime pin (implemented)

- Changed `resources/dsh-agent/runtime.json` from Node 22.22.1 to Node 24.18.0.
- Added staged-runtime artifacts (`VERSION`, `THIRD_PARTY_NOTICES`, `licenses/`)
  to `.gitignore`.
- Updated `scripts/dsh-agent/prepare-runtime.mjs`:
  - requires the exact Node version from `runtime.json`;
  - rejects a `.nvmrc` / `runtime.json` mismatch before staging;
  - reports missing runtime pieces with a clearer `--check` message.
- Updated the runtime documentation to the new pin:
  `docs/dsh-agent/README.md`, `docs/dsh-agent/operations.md`,
  `docs/dsh-agent/release.md`, `resources/dsh-agent/README.md`, ADR 0001/0002,
  and `docs/dsh集成tscode计划.md` §14.
- Verified on macOS arm64:
  - staged dsh + Node 24.18.0 with `prepare-runtime.mjs`;
  - `prepare-runtime.mjs --check` passes;
  - `e2e-smoke.mjs` passes against the staged runtime;
  - the same flow passes when dsh is installed with Node 24.18.0's npm 11
    (`allow-scripts` warnings only; `node-pty` still spawns);
  - GUI starts with the staged Node 24.18.0 runtime, `status: ready`, bridge,
    plugin, and theme work;
  - app + Host exit cleanly on SIGTERM.

Remaining:

- macOS x64 / Windows x64 staging, smoke, and native-dependency checks.
- Real tool-call / approval / cancel E2E with an API key.
- Linux glibc baseline re-check.

## 2026-10-24 — Runtime analysis and Node 24 migration plan (docs only)

Scope: documentation and analysis. No runtime pin or code change in this entry.

- Added `docs/dsh-agent/adr-0002-node-runtime.md`:
  - Recorded that the Electron blocker is the exact Electron/V8 fingerprint
    check in `node-addon-require-builtin`, not Node 22 vs 24.
  - Recorded the Electron 43.7.3 failure and the supported Electron list.
  - Recorded the successful Node 24.18.0 Host smoke, GUI, and native-dependency
    checks on macOS arm64.
  - Proposed keeping the Node sidecar and migrating the pin from 22.22.1 to
    24.18.0.
- Corrected stale Electron references from 39.8.7 to the shipped 43.7.3 in:
  - `docs/dsh-agent/adr-0001-agent-window.md` (amendment; original decision
    kept).
  - `docs/dsh-agent/README.md`.
  - `resources/dsh-agent/README.md`.
  - `docs/dsh集成tscode计划.md` §0.2, §13.3, §14.
- Added §14 to `docs/dsh集成tscode计划.md` with the optimization plan and
  validation status.
- Updated the production-readiness checklist with the Node-version alignment
  item and the native-dependency status.
- Recorded the 2026-10-24 re-verification: compile, 32 dshAgent unit tests,
  e2e smoke, GUI bridge/theme/host-reuse/crash-restart/no-orphan, and Node
  24.18.0 evaluation.

Follow-up (completed in the entry above):

- Applied the Node 24.18.0 pin to `resources/dsh-agent/runtime.json` and
  `scripts/dsh-agent/prepare-runtime.mjs`.

Still pending:

- Re-run the runtime smoke on macOS x64 and Windows x64.
- Run the real tool-call/approval/cancel E2E with an API key.
- Re-check the Linux glibc baseline for Node 24.18.0.

## 2026-10-24 — Initial integration

Commit: `57deca45798` (`dsh集成`).

- Added the dedicated dsh Agent window (`dsh-agent://app`) in the Electron main
  process with an isolated session partition.
- Added the dsh Host lifecycle, token-to-cookie authentication, HTTP proxy, and
  WebSocket header fence.
- Added the preload bridge (`window.tscodeAgent`), directory-picker bridge, and
  the `dsh-client-tscode` dsh client plugin.
- Added Workbench integration: command/menu/keybinding, workspace/selection/
  theme context, open file/diff/reveal.
- Added profile hardening, Workspace Trust gating, crash reports, telemetry,
  feature flags, packaging scripts, and release-workflow staging.
- Added unit/integration tests and `scripts/dsh-agent/e2e-smoke.mjs`.
- Added `docs/dsh-agent/{README,adr-0001-agent-window,operations,release,security}.md`
  and `docs/dsh集成tscode计划.md`.

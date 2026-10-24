# dsh Agent changelog

This file records changes to the dsh Agent integration. Code changes follow the
repository's `test-workbench_change` marker convention; this file is the
human-readable counterpart.

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

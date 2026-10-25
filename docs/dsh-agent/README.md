# dsh Agent in tscode

Status: implementation for the v1 plan is in the repository. This document is
the operator/developer entry point; see `docs/dsh集成tscode计划.md` for the
program plan, `docs/dsh-agent/adr-0002-node-runtime.md` for the Electron/Node
runtime analysis, `docs/dsh-agent/trae-agent-window-research-and-plan.md` for
the Trae Agent-window comparison and evolution plan, and
`docs/dsh-agent/changelog.md` for change history.

## What ships

- A dedicated `BrowserWindow` loading the dsh web frontend at `dsh-agent://app`.
- An isolated Host child process: bundled Node 24.18.0 + pinned dsh runtime,
  `DSH_HOME=~/.tscode-dsh`.
- A custom protocol that serves the Host index and proxies HTTP (`/api`,
  `/plugins`, `/connect`) with an authority cookie that never reaches the page.
- A WebSocket fence that rewrites `Origin` and injects the Host cookie for
  `ws://127.0.0.1:<host-port>/...` connections from the Agent window.
- A bounded preload bridge (`window.tscodeAgent`), a directory-picker bridge
  (`__DSH_DIRECTORY_PICKER__`) that opens the IDE's native folder dialog with
  the current workspace as its default path, and a dsh client plugin
  (`resources/dsh-agent/plugin/dsh-client-tscode`) that is provisioned into the
  profile automatically.
- Per-window theme emulation so the dsh UI follows the IDE Light/Dark theme
  without changing VS Code's global `nativeTheme`.
- A workbench contribution that publishes workspace/selection/theme context and
  opens files/diffs in the IDE.
- Profile hardening, Workspace Trust gating, crash reports, telemetry, and
  packaging scripts.

## Quick start (development)

```bash
# Node 24.18.0 (matching .nvmrc) and a global `dsh` must be on PATH.
nvm use   # reads .nvmrc
./scripts/code.sh
```

Then run **dsh Agent: Open dsh Agent Window** (`Ctrl/Cmd+Alt+A`) from the
Command Palette.

To use the packaging path instead of PATH:

```bash
node scripts/dsh-agent/install-runtime-from-tarballs.mts \
  --from <fork-packed-dir>/dsh \
  --from <fork-packed-dir>/vendor \
  --from <fork-packed-dir>/landlock
node scripts/dsh-agent/prepare-runtime.mjs \
  --dsh .build/dsh-runtime/node_modules/@deepseek-ai/dsh \
  --node "$(which node)"
node scripts/dsh-agent/prepare-runtime.mjs --check
```

The packaging path also installs the pnpm version pinned in
`resources/dsh-agent/runtime.json` and exposes it next to the bundled Node, so
plugin installs in a packaged build do not require a global pnpm. Development
runs through a global `dsh` still use the caller's pnpm.

## Architecture

```text
tscode main process
├─ DshAgentMainService
│  ├─ DshAgentHostProcess ──spawn──> node 24.18.0 dsh web --no-open --host 127.0.0.1 --port 0
│  │                                  DSH_HOME=~/.tscode-dsh
│  ├─ session(partition=persist:tscode-dsh-agent)
│  │  ├─ protocol.handle('dsh-agent') ──HTTP proxy + CSP──> Host
│  │  ├─ webRequest WS fence ──Origin/cookie injection──> Host /api/remote.mux
│  │  └─ permission handlers (clipboard-sanitized-write, notifications only)
│  ├─ BrowserWindow (sandbox, contextIsolation, no nodeIntegration)
│  │  └─ preload: __DSH_TRANSPORT__, window.tscodeAgent
│  └─ bridge IPC: context / openFile / openDiff / reveal / status
└─ workbench contribution
   ├─ publishes workspace folders, active file, selection, theme, locale, trust
   └─ receives openFile/openDiff/reveal from main and drives IEditorService
```

## Files

| Area | Files |
| --- | --- |
| Shared types/validation | `src/vs/platform/dshAgent/common/dshAgent.ts` |
| Host process | `src/vs/platform/dshAgent/electron-main/dshAgentHost.ts` |
| Protocol/proxy | `.../dshAgentProtocol.ts`, `src/vs/platform/dshAgent/node/dshAgentProxy.ts` |
| Window | `.../dshAgentWindow.ts` |
| Orchestrator | `.../dshAgentMainService.ts` |
| Profile hardening | `.../dshAgentProfile.ts`, `.../dshAgentPaths.ts` |
| Preload bridge | `src/vs/platform/dshAgent/electron-browser/dshAgentPreload.ts` |
| Workbench bridge | `src/vs/workbench/contrib/dshAgent/electron-browser/dshAgent.contribution.ts` |
| dsh client plugin | `resources/dsh-agent/plugin/dsh-client-tscode` |
| Packaging | `scripts/dsh-agent/*.mjs`, `resources/dsh-agent/README.md` |
| Tests | `src/vs/platform/dshAgent/test/**`, `scripts/dsh-agent/e2e-smoke.mjs` |

## Configuration

| Setting | Default | Scope | Meaning |
| --- | --- | --- | --- |
| `dsh.agentWindow.enabled` | `true` | application | Local feature flag |
| `dsh.agentWindow.requireTrustedWorkspace` | `true` | application | Refuse to start in an untrusted folder |
| `dsh.agentWindow.autoRestart` | `true` | application | Restart the Host after an unexpected exit |
| `dsh.agentWindow.profile` | `web` | application | dsh profile name |
| `dsh.agentWindow.nodePath` | `""` | machine | Override Node (current pin 24.18.0) |
| `dsh.agentWindow.dshEntry` | `""` | machine | Override `@deepseek-ai/dsh/lib/bin.js` |
| `dsh.agentWindow.dshHome` | `""` | machine | Override `DSH_HOME` |

Remote rollout controls live in `product.json` under `dshAgent.enabled` and
`dshAgent.killSwitch`. `TSCODE_DSH_AGENT_DISABLED=1` is the local kill switch.

## Testing

```bash
# Type check
npx tsgo --project ./src/tsconfig.json --noEmit --skipLibCheck

# Unit + integration tests (after transpile)
npx tsx build/next/index.ts transpile
npx mocha test/unit/node/index.js --delay --ui=tdd --timeout=15000 --exit

# Real Host smoke (auth, proxy, plugin bundle, traversal)
node scripts/dsh-agent/e2e-smoke.mjs
```

The smoke test starts the real `dsh web` in a temporary `DSH_HOME`, exchanges
the token for a cookie, proxies the application document and a plugin bundle,
and verifies traversal rejection. It does not require Electron.

## Manual E2E checklist

1. Open a trusted folder, run **Open dsh Agent Window**.
2. Send a message; verify streaming, tool approval, and cancel.
3. Click a workspace file link in the chat; the IDE opens the file.
4. Use **Open File** from a dsh tool result; selection and language context match.
5. Switch the IDE theme; the Agent window follows (`prefers-color-scheme`).
6. Close the Agent window; the task keeps running. Reopen it; the session is intact.
7. Quit tscode; confirm no `dsh` child remains (`pgrep -fl 'dsh.*web'`).
8. Revoke workspace trust and reopen; the Host must not start.
9. Switch Light/Dark; the Agent UI follows within ~1s.
10. Add a workspace from the Agent picker; it returns the IDE root.
11. Quit with Cmd+Q; confirm the Host exits (no orphan).


## Verified on 2026-10-24

Environment: macOS arm64, Electron 43.7.3, Node 24.18.0, dsh 0.2.0-rc.2.

- `npm run compile-client` is clean.
- The dshAgent unit tests pass (32 passing).
- `scripts/dsh-agent/e2e-smoke.mjs` passes against a real `dsh web`: token
  exchange, boot graph, plugin bundle, WS mux handshake, traversal rejection.
- GUI/CDP run: dsh UI renders, the bridge returns workspace/editor/selection
  context, `openFile`/`openDiff`/`revealInExplorer` work, the workspace picker
  returns the IDE root, themes stay in sync, close hides, reopen reuses the
  Host, `kill -9` restarts it with a crash report, and SIGTERM leaves no Host
  process.
- Runtime evaluation: staging with Node 24.18.0 and `prepare-runtime.mjs
  --check` pass; `e2e-smoke.mjs` and the GUI pass against the staged runtime.
  `node-pty`, `sharp`, `koffi`, and `flock` also load and execute under Node
  24.18.0. See `adr-0002-node-runtime.md`.

Remaining verification requires an API key (model tool calls, approvals,
cancellation), signing certificates, Windows/x64 CI, and a security review.

# dsh Agent operations runbook

## Logs and diagnostics

| Artifact | Location |
| --- | --- |
| Host stdout/stderr (redacted) | tscode main log, `[dshAgent:host]` |
| Host crash reports | `<userData>/logs/dsh-agent/crash-*.json` (max 10) |
| Profile facts | `~/.tscode-dsh/tscode-agent-profile.json` |
| Managed dsh patch | `~/.tscode-dsh/cordis.patch.yml` |
| dsh sessions | `~/.tscode-dsh/sessions/` |

Crash reports contain versions, exit code/signal, stderr tail, profile hash, and
the workspace path. They never contain prompts, code, or file contents.
`redactDshAgentLog` strips tokens, cookies, bearer headers, and `*_key=` values
before anything is logged or persisted.

## Runtime pin

The current Host pin is Node 24.18.0 (`resources/dsh-agent/runtime.json`),
matching `.nvmrc`. `prepare-runtime.mjs` rejects a mismatch between the two.
The pin is implemented and validated on macOS arm64; macOS x64 and Windows x64
validation is still pending (see `adr-0002-node-runtime.md`).

Electron's embedded Node cannot host dsh: `dsh-app-boot` uses
`node-addon-require-builtin`, which validates an exact Electron/V8 fingerprint;
Electron 43.7.3 is not in its supported table.

## Restart policy

| Failure | Behaviour |
| --- | --- |
| Host exits before ready | Start failure; window shows the error page |
| Host exits while running | Up to 3 restarts with 500 ms → 8 s backoff |
| 3 restarts exhausted | Safe mode: fresh `~/.tscode-dsh-safe` home, no user plugins |
| Safe mode fails | `Failed` status, error page, crash report |
| User quits tscode | `SIGTERM` to the process group, 10 s grace, then `SIGKILL` |

The window never owns the Host lifecycle: closing hides it so an in-flight turn
continues. Quitting the app joins Host shutdown through
`lifecycleMainService.onWillShutdown`.

## Triage

1. Check `crash-*.json` for `exitCode`, `signal`, `stderrTail`, `profileHash`.
2. Verify the runtime: `node scripts/dsh-agent/prepare-runtime.mjs --check` and
   `node scripts/dsh-agent/size-report.mjs`.
3. Reproduce with the smoke script:
   `node scripts/dsh-agent/e2e-smoke.mjs --keep`. It prints the temporary
   `DSH_HOME`; inspect `profiles/web/package.json` and `cordis.patch.yml`.
4. If the error started after a dsh upgrade, restore the previous runtime
   snapshot (`scripts/dsh-agent/rollback-runtime.mjs`) or reinstall the previous
   tscode build.
5. If the window loads but tools fail, check the Host log for approval or
   plugin errors. The managed profile disables plugin installation/HMR; a plugin
   the user installed earlier may be skipped.

## Kill switch

- Remote: set `dshAgent.killSwitch: true` in `product.json` for a release.
- Local: `TSCODE_DSH_AGENT_DISABLED=1` or `dsh.agentWindow.enabled: false`.
- Disabling keeps `~/.tscode-dsh` data; it only removes the entry point.

## Uninstall / cleanup

1. Disable the feature flag.
2. Remove `~/.tscode-dsh` and `~/.tscode-dsh-safe` if the user wants session data
   removed. `removeDshAgentProfileFiles` in `dshAgentProfile.ts` removes only the
   managed patch block and marker.
3. Remove `<userData>/logs/dsh-agent`.

## Release checklist (host side)

- [ ] `prepare-runtime.mjs --check` passes on macOS arm64/x64 and Windows x64.
- [ ] `e2e-smoke.mjs` passes with the bundled Node and dsh.
- [ ] `size-report.mjs` recorded in the release notes.
- [ ] `THIRD_PARTY_NOTICES` refreshed from the dsh and Node licenses.
- [ ] macOS notarization and Windows signing completed by the release pipeline.
- [ ] Previous build is available for rollback.

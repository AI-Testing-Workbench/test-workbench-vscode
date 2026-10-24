# ADR 0002: Node runtime for the dsh Agent Host

- Status: accepted (implemented on macOS arm64; cross-platform validation pending)
- Date: 2026-10-24
- Supersedes: the runtime-version part of ADR 0001
- Related: `docs/dsh集成tscode计划.md` §14, `docs/dsh-agent/changelog.md`

## Context

ADR 0001 chose a separate dsh Host child process because Electron's embedded
Node could not satisfy dsh's runtime expectations. That decision was written
against Electron 39.8.7 and a Node 22.22.1 pin.

The fork now ships Electron 43.7.3 (`.npmrc` `target="43.7.3"`), whose embedded
runtime is:

```text
Node 24.21.0
V8 15.0.245.31-electron.0
NODE_MODULE_VERSION 148
N-API 10
```

The repository build Node is 24.18.0 (`.nvmrc`). At the time of this analysis,
`resources/dsh-agent/runtime.json` still pinned Node 22.22.1; it now pins
24.18.0 (see Implementation status).

This ADR re-evaluates three questions:

1. Can Electron's embedded Node now run the Host?
2. Which standalone Node version should be bundled?
3. How do we keep the runtime pin, CI, and documentation in sync?

## Findings

### 1. The blocker is an Electron/V8 fingerprint, not Node 22 vs 24

`@deepseek-ai/dsh-app-boot` boots through `node-addon-require-builtin`
(`dsh-app-boot/lib/index.js`, `requireBuiltin("internal/modules/esm/loader")`
and `internal/modules/cjs/loader`). The native addon contains a version-specific
fingerprint table for Electron/V8 internals and fails closed on a mismatch.

Running the pinned dsh with Electron 43.7.3 as Node fails:

```bash
ELECTRON_RUN_AS_NODE=1 .build/electron/TestAgent工作台.app/Contents/MacOS/tscode \
  ~/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
  web --no-open --host 127.0.0.1 --port 0
```

```text
unsupported Electron runtime fingerprint:
Node 24.21.0, V8 15.0.245.31-electron.0
(supported Electron versions: 43.0.0, 44.0.0, 44.7.0, 45.0.0-alpha.6)
```

Electron 43.7.3 is therefore not usable even though its major version is 43.
Pinning Electron to exactly 43.0.0/44.0.0/44.7.0 to match the table would block
upstream security updates and is not maintainable.

The same addon reports an un-tagged Node 20/22/24 family path, so standalone
Node 24 is a different code path from Electron's Node 24.

### 2. Standalone Node 24.18.0 works

The pinned dsh 0.2.0-rc.2 has no `engines` constraint and its native
dependencies are N-API modules. The following was verified on macOS arm64:

| Check | Result |
| --- | --- |
| `dsh --version` | `0.2.0-rc.2`, exit 0 |
| `dsh web --no-open --host 127.0.0.1 --port 0` | Ready on loopback |
| `e2e-smoke.mjs` with Node 24.18.0 as Host | PASS; Host ready 578 ms |
| GUI with `TSCODE_DSH_AGENT_NODE` set to Node 24.18.0 | `status: ready`; Host process is Node 24.18.0 |
| `node-pty` | Spawned `/bin/sh`, received output |
| `sharp` | Generated an 8x8 PNG |
| `koffi` | Loaded 3.1.1 |
| `flock` | Exclusive lock acquired with Node 24.18.0 |

Node 22.22.1 was the shipped pin at the time of this analysis and is also
verified. Node 24.18.0 replaced it on 2026-10-24.

### 3. The pin and CI had drifted

At the time of this analysis, `.nvmrc` was 24.18.0 but
`resources/dsh-agent/runtime.json` pinned 22.22.1. `prepare-runtime.mjs`
rejected any Node outside 22.22.x, while the release workflows pass
`"$(which node)"` / `(Get-Command node).Source` from the setup-node action that
reads `.nvmrc`. The staging step therefore failed before the application was
packaged. The pin is now aligned and the script rejects future drift. See
`docs/dsh-agent/changelog.md` for the 2026-10-24 entries.

## Decision

1. **Keep the separate Node sidecar.** Electron's embedded Node remains
   unusable for dsh at the current Electron build.
2. **Use Node 24.18.0 as the bundled Host runtime** (migrated from 22.22.1 on
   2026-10-24). Use the same version as `.nvmrc` so the repository build Node,
   CI, and the bundled Host runtime share one source of truth.
3. **Do not use Electron's embedded Node.** The `node-addon-require-builtin`
   fingerprint table is tied to exact Electron/V8 builds, not to a Node
   major/minor family.
4. **Keep the runtime version single-sourced.** `runtime.json` remains the
   packaged-runtime pin; `.nvmrc` remains the build Node; CI must compare them.

## Implementation status (2026-10-24)

- [x] `resources/dsh-agent/runtime.json` pins Node 24.18.0.
- [x] `prepare-runtime.mjs` requires the exact pinned Node and rejects a
      `.nvmrc` / `runtime.json` mismatch.
- [x] macOS arm64: staging, `--check`, `e2e-smoke.mjs`, and GUI with the staged
      Node 24.18.0 runtime pass.
- [ ] macOS x64 / Windows x64 staging and native-dependency checks.
- [ ] Real tool-call / approval / cancel E2E with an API key.
- [ ] Linux glibc baseline re-check.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Use Electron 43.7.3 `ELECTRON_RUN_AS_NODE` | Fails the exact fingerprint check today; every Electron V8 bump can break it again. |
| Pin Electron to 43.0.0 / 44.0.0 / 44.7.0 | Blocks upstream Electron security updates and couples the product to dsh's private fingerprint table. |
| Bundle Node 22.22.1 and special-case CI | Works, but keeps a second Node version in the pipeline and leaves `.nvmrc`/pin drift. Use as fallback only. |
| Use the user's system Node | Non-reproducible across machines and unsupported for packaging. |
| Remove the sidecar to save size | Saves roughly the Node binary (~108–115 MB uncompressed), but breaks boot today and is not worth the reliability risk for v1. |

## Migration plan

### P0 — applied 2026-10-24 (macOS arm64 verified)

- [x] Change `resources/dsh-agent/runtime.json` from `"node": "22.22.1"` to
  `"node": "24.18.0"`.
- [x] Update the Node guard in `scripts/dsh-agent/prepare-runtime.mjs` to match
  the pin exactly, and reject a `.nvmrc` / `runtime.json` mismatch before the
  runtime copy. CI invokes this script, so the release staging step inherits
  the check.
- [x] Keep the release workflows on `actions/setup-node` + `.nvmrc`; with the
  aligned pin, `--node "$(which node)"` stages Node 24.18.0 without a second
  download.
- [x] Update `docs/dsh-agent/README.md`, `resources/dsh-agent/README.md`,
  `docs/dsh-agent/operations.md`, and `docs/dsh-agent/release.md` with the new
  pin.

### P1 — validate before enabling the pin for all platforms

- Run `e2e-smoke.mjs` on macOS x64 and Windows x64 with the bundled Node
  24.18.0 binary.
- Re-run the native-dependency checks on Windows (`node-pty` ConPTY, `sharp`,
  `koffi`, and the Windows file-lock path).
- Run a real tool-call session (read/write/command, approval, cancel) with an
  API key; A6 and F3 remain unverified without one.
- Re-check the Linux glibc baseline for the Node 24.18.0 binary; Linux remains
  beta in v1.
- Record the packaged size delta with `npm run dsh-agent:size`.

### P2 — revisit later

- Re-evaluate Electron-as-Node only when dsh publishes a
  `node-addon-require-builtin` build that supports the exact Electron/V8 build
  used by the fork.
- Consider trimming the Node payload only after the sidecar has shipped and
  soak-tested.

## Consequences

- The current CI blocker is removed by aligning `.nvmrc` and the runtime pin.
- Node 24 has a longer support window than Node 22.
- The Node 24.18.0 binary is ~7 MB larger than 22.22.1 uncompressed; the
  compressed installer delta is small.
- No change to the window, protocol, proxy, bridge, or trust model.
- Cross-platform validation and real tool-call E2E are still required before
  GA; the pin is already applied and verified on macOS arm64.

## Re-evaluation triggers

- dsh starts using an Electron build that matches the fork's Electron/V8.
- dsh changes its Node engine range or replaces `node-addon-require-builtin`.
- The fork upgrades Electron and changes the V8 build.
- Node 24 approaches end of life.

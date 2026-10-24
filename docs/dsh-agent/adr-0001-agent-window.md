# ADR 0001: dsh Agent window in tscode

- Status: accepted
- Date: 2026-10-24
- Owners: tscode architecture

## Context

tscode is a VS Code fork. The product goal is a Trae-like Agent mode with the
full dsh UI, plugins, and toolchain, while keeping one application, one
installer, and one update channel.

Two constraints dominate:

1. Electron 39.8.7 carries a Node build that is incompatible with dsh's native
   dependencies and runtime fingerprint expectations.
2. The dsh frontend boots from a server-rendered index containing
   `__DSH_BOOT__`; its client modules, plugin bundles, and WebSocket mux assume
   a single authority.

## Decision

Run a **separate dsh Host child process** under a bundled **Node 22.22.1** and
host the dsh web frontend in a **dedicated BrowserWindow** inside tscode.

- The window uses the custom standard scheme `dsh-agent://app`.
- The Host runs `dsh web --no-open --host 127.0.0.1 --port 0` with
  `DSH_HOME=~/.tscode-dsh`.
- The main process exchanges the one-time token for an authority cookie and
  proxies HTTP through `session.protocol.handle('dsh-agent')`.
- The WebSocket mux connects directly to the loopback Host; a per-session
  `webRequest` fence rewrites `Origin` and injects the cookie, and rejects any
  other loopback target.
- The dsh frontend is not modified. The preload publishes
  `__DSH_TRANSPORT__.streamBaseUrl` before the first client module and exposes
  a whitelist bridge, `window.tscodeAgent`.
- IDE integration is a dsh client plugin plus a preload fallback, not a VS Code
  extension API surface.

## Why not `dsh-desktop-host`

The upstream desktop shell uses the private `@deepseek-ai/dsh-desktop-host`
package, which reports `ready`, `injections`, and lifecycle control over IPC.
It is not published. v1 uses the public `dsh web` index instead, which already
embeds `__DSH_BOOT__`. This reduces supply-chain and version-coupling risk at
the cost of not having Host-side injection APIs; see
`resources/dsh-agent/host/README.md`.

## Why not the VS Code Agent Host chat UI

The target experience requires dsh's own plugins, layout, session model, and
tool presentation. Re-implementing those in the native chat UI would fork the
dsh frontend and lose upstream compatibility.

## Consequences

- One extra child process per app session; Host idle RSS budget is 400 MB.
- All Host traffic is loopback; no remote/SSH/multi-root support in v1.
- The custom protocol origin differs from the Host origin, so the cookie is
  main-process-only and the page cannot read it.
- Upstream dsh upgrades require a runtime restage and a smoke run.
- Fork changes are isolated under `src/vs/platform/dshAgent`,
  `src/vs/workbench/contrib/dshAgent`, `resources/dsh-agent`, and
  `scripts/dsh-agent`, with `test-workbench_change` markers at shared hooks.

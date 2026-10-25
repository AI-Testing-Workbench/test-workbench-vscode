# dsh Agent security model

## Window

| Control | Value |
| --- | --- |
| `nodeIntegration` | `false` |
| `nodeIntegrationInWorker` / `SubFrames` | `false` |
| `contextIsolation` | `true` |
| `sandbox` | `true` |
| `webSecurity` | `true` |
| `allowRunningInsecureContent` | `false` |
| `webviewTag` | `false` |
| Session | `persist:tscode-dsh-agent` (dedicated partition) |
| Origin | `dsh-agent://app` only |
| Navigation | `will-navigate` / `will-redirect` allow only the Agent origin |
| Popups | `setWindowOpenHandler` denies; http(s)/mailto go to the system browser |
| Webviews | `will-attach-webview` prevented |
| Permissions | clipboard-sanitized-write, notifications; everything else denied |

The protocol response for HTML sets:

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' dsh-agent:;
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
  connect-src 'self' dsh-agent: <host-origin> <ws-host-origin>;
  object-src 'none'; base-uri 'self'; form-action 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

`'unsafe-inline'` is required because the dsh index embeds the boot graph and
theme bootstrap as inline scripts. `'unsafe-eval'` is required by the upstream
dsh client, which evaluates small expression payloads during plugin boot; this
is a reviewed exception, not a general remote-code allowance. The page only
loads first-party code from `dsh-agent://app` and the loopback Host.

## Authentication

- The Host prints a loopback URL with a one-time token.
- The main process performs `GET <url>` with `redirect: 'manual'`, requires a
  `303` and a `set-cookie`, stores only the `name=value` pair, and never sends
  the token to the renderer.
- HTTP requests to `dsh-agent://app/*` are forwarded with that cookie. The
  renderer cannot read it (HttpOnly, main-process memory only).
- WebSocket requests are only rewritten when all of these hold:
  `details.webContentsId` is the Agent window, the target host/port equals the
  Host, the protocol is the matching `ws`/`wss`, and the renderer `Origin` is
  exactly `dsh-agent://app`. Everything else is cancelled.

## Bridge

`window.tscodeAgent` exposes only:

- `getContext`, `getStatus`, `reportReady`
- `openFile`, `openDiff`, `revealInExplorer`
- `onContextChanged`, `onThemeChanged`

Main-process handlers verify the sender is the Agent window's main frame and
that the frame URL is on `dsh-agent://app`. File requests must be absolute,
bounded, and inside a workspace folder of the last published context. Invalid
requests are rejected and counted (`dshAgentBridgeRejected`). The renderer
validates again before calling `IEditorService` / `IExplorerService`.

`openFile`/`openDiff` are one-way commands to the IDE window. The Agent cannot
execute shell commands, read arbitrary files, or invoke VS Code commands through
this bridge.

## dsh permissions

The integration keeps dsh's native extension model, including the plugin
management UI, settings, inventory, official-package inventory, market
surfaces, `hmr` live configuration reload, and the agent-facing
`plugin_manager` tool. The managed profile patch therefore disables nothing and
is removed (or left as `[]`) when it contains no user rows.

`plugin-manager` and `tool-plugin-manager` must remain enabled: dsh 0.2.1 ships
agent presets that mount `@deepseek-ai/dsh-plugin-manager/tools`, and disabling
the service makes every new session fail with
`agent-preset/invalid: ... waiting for pluginManager`.

Installed plugins run outside the workspace sandbox. The agent-facing tool
requires an explicit `danger-full-access` approval for each call (it can persist
profile changes, so approval is not implied by workspace-write). Users are
responsible for the trust and provenance of plugins they install; the IDE does
not add a second allowlist on top of dsh's own install flow.

Tool approvals remain owned by dsh's own approval UI. v1 does not mount
`computer_use`, `browser_use`, or arbitrary remote MCP servers. The dsh sidebar
browser (`ui-sidebar-browser`) is not the agent browser tool.

## Data

- `DSH_HOME=~/.tscode-dsh` is isolated from `~/.dsh`.
- dsh writes its own credentials to `~/.tscode-dsh/.credentials.yaml` with mode
  `0600`; the Agent integration does not copy them elsewhere. Migrating this
  store to VS Code SecretStorage / OS Keychain is a v1 gap (D5), tracked in
  `operations.md`.
- Logs are redacted and stored under `<userData>/logs/dsh-agent`.
- Crash reports contain no prompts, code, or file contents.
- Telemetry payloads contain only durations, counts, status flags, and
  operation/reason strings; no paths, prompts, or model output.
- Uninstall cleanup is documented in `operations.md`.

## Workspace Trust

When `dsh.agentWindow.requireTrustedWorkspace` is true (default), `openWindow`
refuses to start the Host if the workspace has folders and the workbench reports
it as untrusted. An empty window is treated as trusted. Trust changes are pushed
with each context update.

## Known gaps before GA

- No external security review or IPC fuzz suite yet (plan items D6/F6).
- dsh credentials live in its own `0600` file rather than VS Code
  SecretStorage / OS Keychain (D5).
- `openInApp` account flows from dsh are not wired to tscode's account model.
- The dsh web index is trusted first-party code; CSP cannot protect against a
  compromised Host or a malicious installed dsh plugin.
- The runtime-override settings are machine-scoped and intended for developers;
  a managed deployment should lock them.

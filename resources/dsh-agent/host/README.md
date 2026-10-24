# dsh-desktop-host (not shipped)

The upstream dsh Desktop application launches `@deepseek-ai/dsh-desktop-host`
and receives three facts over IPC: the authenticated URL, boot injections, and
profile lifecycle events. That package is `private` in the dsh monorepo and is
not part of the public `@deepseek-ai/dsh` npm package.

tscode does not vendor `dsh-desktop-host` in v1. Instead the launcher runs the
public `dsh web` profile and proxies the Host index, which already contains
`__DSH_BOOT__`. This keeps a smaller supply-chain surface and avoids depending
on a private package.

If a later phase adopts `dsh-desktop-host`, stage it here and change
`DshAgentHostProcess` to speak its IPC protocol (`ready`, `fatal`,
`shutdown`, `quit-inspection`, `update-tasks`).

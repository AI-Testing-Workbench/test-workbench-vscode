<!--
  OPENCODE_INTEGRATION.md — OpenCode Agent 集成方案总结
  对应代码: src/vs/platform/agentHost/node/openCode/
-->

# OpenCode Agent 集成方案

> **状态: Beta** (2026-07-26)
> 基本聊天功能可用，tool call、权限、历史等尚未支持。

---

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────┐
│ VS Code UI (Renderer)                                    │
│  agentHostSessionHandler.ts                              │
│    │ dispatch(ChatTurnStarted) → IPC                       │
│    ▼                                                      │
│ localAgentHostService.ts                                 │
└──────────────┬───────────────────────────────────────────┘
               │ IPC (MessagePort)
┌──────────────▼───────────────────────────────────────────┐
│ Agent Host Process (Main / Utility Process)              │
│                                                          │
│  AgentService (agentService.ts)                          │
│    │ dispatchAction → _sideEffects.handleAction            │
│    ▼                                                      │
│  AgentSideEffects (agentSideEffects.ts)                  │
│    │ ChatTurnStarted → _sendTurnMessage                   │
│    │   │ agent.chats.sendMessage(chatUri, ...)            │
│    ▼   ▼                                                  │
│  OpenCodeAgent (openCodeAgent.ts)                        │
│    │ 实现 IAgent 接口                                     │
│    │                                                      │
│    │ createSession → spawn opencode → _sessions           │
│    │ sendMessage  → _resolveSession → session.sendMessage │
│    ▼                                                      │
│  OpenCodeSession (openCodeSession.ts)                    │
│    │ _fireAction → AgentSignal → _onDidSessionProgress    │
│    │   → AgentSideEffects._handleAgentSignal              │
│    │   → AgentHostStateManager.dispatchServerAction       │
│    ▼                                                      │
│  ┌─────────────────────────────┐                         │
│  │ $ opencode serve --port=0   │  ← child_process.spawn  │
│  │   POST /session/            │                         │
│  │   POST /session/:id/message │  ← HTTP REST (fetch)    │
│  └─────────────────────────────┘                         │
└──────────────────────────────────────────────────────────┘
```

数据流:

1. **下行**: VS Code UI → IPC → AgentService → AgentSideEffects → OpenCodeAgent.chats.sendMessage → HTTP POST opencode
2. **上行**: opencode stream → OpenCodeSession._processStreamingJSON → _fireAction(AgentSignal) → AgentSideEffects._handleAgentSignal → StateManager.dispatchServerAction → IPC → UI 渲染

---

## 2. 与其他 Agent 架构对比

| 维度 | OpenCode | Copilot | Claude | Codex |
|------|----------|---------|--------|-------|
| **backend 进程** | `opencode serve` | `@github/copilot-<platform>` Node.js CLI | `@anthropic-ai/claude-agent-sdk` | `codex app-server` |
| **启动方式** | `cp.spawn` + stdout 正则匹配 URL | `RuntimeConnection.forStdio()` | SDK 内建 | `cp.spawn` + stdio |
| **Agent ↔ Backend 协议** | HTTP REST (localhost) | JSON-RPC over stdio | 原生 SDK | JSON-RPC over stdio (NDJSON) |
| **多 chat 支持** | ❌ stub | ✅ | ✅ | ❌ |
| **Fork** | ❌ | ✅ | ✅ | ❌ |
| **tool call 模型** | ❌ | SDK 处理 | SDK 处理 | JSON-RPC request/notification |
| **模型发现** | 硬编码 `OPENCODE_MODELS` | SDK `models.list` | SDK `models.list` | SDK 内建 |
| **认证** | `OPENCODE_AUTH` env / Basic auth | GitHub token (CAPI) | API key / CAPI proxy | GitHub token + local proxy |
| **文件操作** | ❌ (opencode 自行处理) | CopilotApiService (CAPI) | SDK 内建 | codex 二进制自己处理 |
| **permission** | ❌ (stub) | SDK 内建 | SDK 内建 | JSON-RPC requestApproval |

### 注意事项

1. **与 Codex 传输差异**: Codex 用 `child_process.spawn` + **stdio JSON-RPC (NDJSON)**，OpenCode 用 **HTTP REST**。两者的共同点是都 spawn 子进程，但 Codex 走 stdio 管道（更可靠，不需要端口探测），OpenCode 走 HTTP（依赖 `--port=0` + stdout 正则匹配，脆弱）。

2. **与 Copilot 传输差异**: Copilot 的 `RuntimeConnection.forStdio()` 封装了 SDK 的 stdio JSON-RPC，OpenCode 直接调用 `fetch()`。后续优化方向应改为 stdio JSON-RPC。

3. **`chatChannelUri` 处理**: 和其他 agent 一样，必须使用 `ahp-chat://default/<base64(sessionUri)>` 格式（`buildDefaultChatUri`）。`_fireAction` 的 `resource` 必须填 chat channel URI（`ahp-chat://`），不能填 session URI（`opencode:/`），否则 `AgentHostStateManager` 会抛 `"Chat action dispatched to non-chat channel"`。

4. **`chatChannelUri` 空实现**: `createChat` 返回 `void`（无多 chat）、`fork` 抛错。如需支持多 chat，需参考 Copilot/Claude 在 `AgentSessionEntry` 中维护 `_chats: DisposableMap<string, ...>`。

5. **硬编码模型列表**: 和 Codex/Claude 通过 SDK 动态获取模型不同，OpenCode 使用静态 `OPENCODE_MODELS` 数组。需要改为通过 `opencode` CLI 或 REST API 动态查询。

6. **登录跳过**: `getProtectedResources()` 返回 `[]`、`authenticate()` 返回 `true`。这是 fork 专用修改（详见 `test-workbench_change` 标记），上游集成的 OpenCode agent 可能需要 GitHub 登录才能获取 API 额度。

---

## 3. 当前支持的效果

| 功能 | 状态 | 说明 |
|------|------|------|
| 基本聊天 (send/receive) | ✅ | 支持流式文本响应 |
| 多 session | ✅ | 每个会话独立 `opencode` session |
| abort 取消 | ✅ | `AbortController` + `fetch` signal |
| reasoning (思维链) 显示 | ✅ | 正则匹配 `{"type":"reasoning"...}` |
| token usage 统计 | ✅ | 从最终 JSON 提取 `info.tokens` |
| session 持久化 | ✅ | opencode 自己管理 `/session/` |
| session 恢复列表 | ✅ | `listSessions()` 通过 `GET /session/` |

---

## 4. 当前不支持的效果

| 功能 | 说明 |
|------|------|
| **Tool Call (工具调用)** | `getOrCreateActiveClient` 返回空 tools，opencode 的工具如文件读写在 agent host 不可见 |
| **Permission 弹窗确认** | `respondToPermissionRequest` 是 stub（TODO），`onClientToolCallComplete` 空实现 |
| **模型切换 (changeModel)** | `chats.changeModel` 空实现，无法在对话中途切换模型 |
| **多 Chat / Fork** | `chats.createChat` 返回 void，`chats.fork` 抛错 |
| **Message 历史** | `getMessages()` 返回 `[]`，刷新后看不到历史对话 |
| **Session 配置 (config)** | `resolveSessionConfig` 返回空 schema |
| **Attachment 附件** | `sendMessage` 只传 `prompt` 文本，忽略 `_attachments` |
| **workingDirectory** | 未传给 opencode，opencode 用自己的 cwd |
| **changeAgent** | 空实现 |
| **sessionConfigCompletions** | 返回空 items |
| **peer chat 恢复 (materializeChat)** | 未实现 `IAgent.materializeChat` |

---

## 5. 待改进项

### 高优先级

1. **流式 JSON 解析改用 NDJSON**
   - 现状: `_processStreamingJSON` 用正则匹配 JSON 片段（`/\{"type"\s*:\s*"(text|reasoning)"/}`），脆弱
   - 方案: 解析 NDJSON 逐行 `JSON.parse`，和 opencode-plugin 保持一致

2. **Tool Call 支持**
   - 现状: `getOrCreateActiveClient` 返回空 tools，opencode 的工具调用结果不展示
   - 方案: 解析 opencode 的 tool call SSE 事件，映射为 `ChatToolCallStart` / `ChatToolCallDelta` / `ChatToolCallComplete` action

3. **Message 历史**
   - 现状: `getMessages()` 返回 `[]`，chat 刷新后无历史
   - 方案: 调用 `GET /session/:id/messages` 或 opencode SDK 获取历史，映射为 `Turn[]`

### 中优先级

4. **传输改为 stdio JSON-RPC**
   - 现状: HTTP REST，依赖端口解析 + `fetch`
   - 方案: 参考 Codex 的 `transportFromChildProcess`，用 stdio JSON-RPC 替代

5. **动态模型获取**
   - 现状: 硬编码 `OPENCODE_MODELS`
   - 方案: 通过 opencode 配置或 API 获取可用模型列表

6. **Permission 支持**
   - 现状: `respondToPermissionRequest` 是 TODO
   - 方案: 解析 opencode 的 permission 事件，发射 `pending_confirmation` signal

### 低优先级

7. **多 Chat / Fork**
   - 现状: stub 实现
   - 方案: 参考 Copilot 的 `AgentSessionEntry` + `_chats` DisposableMap 模式

8. **模型切换**
   - 方案: `chats.changeModel` 调用 opencode 配置 API

9. **Attachment / workingDirectory 传递**
   - 方案: `sendMessage` 中把 attachments 和 workingDirectory 编码进请求


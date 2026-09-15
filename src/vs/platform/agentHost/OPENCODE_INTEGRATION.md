<!--
  OPENCODE_INTEGRATION.md — OpenCode Agent 集成方案总结
  对应代码: src/vs/platform/agentHost/node/openCode/
-->

# OpenCode Agent 集成方案

> **状态: Beta** (2026-07-27)
> 基本聊天、流式输出、工具调用展示已可用。权限、历史等功能尚未支持。

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
│  OpenCodeEventStream (openCodeEventStream.ts)            │
│    │ GET /event (SSE) → _handlePartDelta/Updated          │
│    ▼                                                      │
│  ┌─────────────────────────────┐                         │
│  │ $ opencode serve --port=0   │  ← child_process.spawn  │
│  │   POST /session/            │                         │
│  │   POST /session/:id/message │  ← HTTP REST (fetch)    │
│  │   GET  /event               │  ← SSE streaming        │
│  └─────────────────────────────┘                         │
└──────────────────────────────────────────────────────────┘
```

数据流:

1. **下行**: VS Code UI → IPC → AgentService → AgentSideEffects → OpenCodeAgent.chats.sendMessage → HTTP POST opencode
2. **上行 (SSE)**: opencode SSE stream → OpenCodeEventStream → OpenCodeSession.handleEvent → _fireAction(AgentSignal) → AgentSideEffects._handleAgentSignal → StateManager → IPC → UI 渲染
3. **上行 (HTTP fallback)**: opencode HTTP response → OpenCodeSession._processStreamingJSON / _processFinalResponse → 同 SSE 流程

---

## 2. 与其他 Agent 架构对比

| 维度                            | OpenCode                           | Copilot                                    | Claude                             | Codex                         |
| ------------------------------- | ---------------------------------- | ------------------------------------------ | ---------------------------------- | ----------------------------- |
| **backend 进程**          | `opencode serve`                 | `@github/copilot-<platform>` Node.js CLI | `@anthropic-ai/claude-agent-sdk` | `codex app-server`          |
| **启动方式**              | `cp.spawn` + stdout 正则匹配 URL | `RuntimeConnection.forStdio()`           | SDK 内建                           | `cp.spawn` + stdio          |
| **Agent ↔ Backend 协议** | HTTP REST + SSE (localhost)        | JSON-RPC over stdio                        | 原生 SDK                           | JSON-RPC over stdio (NDJSON)  |
| **多 chat 支持**          | ❌ stub                            | ✅                                         | ✅                                 | ❌                            |
| **Fork**                  | ❌                                 | ✅                                         | ✅                                 | ❌                            |
| **tool call 模型**        | ✅ SSE + HTTP                      | SDK 处理                                   | SDK 处理                           | JSON-RPC request/notification |
| **模型发现**              | `GET /provider` 动态获取         | SDK`models.list`                         | SDK`models.list`                 | SDK 内建                      |
| **认证**                  | `OPENCODE_AUTH` env / Basic auth | GitHub token (CAPI)                        | API key / CAPI proxy               | GitHub token + local proxy    |
| **文件操作**              | ❌ (opencode 自行处理)             | CopilotApiService (CAPI)                   | SDK 内建                           | codex 二进制自己处理          |
| **permission**            | ❌ (stub)                          | SDK 内建                                   | SDK 内建                           | JSON-RPC requestApproval      |

### 注意事项

1. **与 Codex 传输差异**: Codex 用 `child_process.spawn` + **stdio JSON-RPC (NDJSON)**，OpenCode 用 **HTTP REST + SSE**。两者的共同点是都 spawn 子进程，但 Codex 走 stdio 管道（更可靠，不需要端口探测），OpenCode 走 HTTP（依赖 `--port=0` + stdout 正则匹配，脆弱）。
2. **与 Copilot 传输差异**: Copilot 的 `RuntimeConnection.forStdio()` 封装了 SDK 的 stdio JSON-RPC，OpenCode 直接调用 `fetch()`。后续优化方向应改为 stdio JSON-RPC。
3. **`chatChannelUri` 处理**: 和其他 agent 一样，必须使用 `ahp-chat://default/<base64(sessionUri)>` 格式（`buildDefaultChatUri`）。`_fireAction` 的 `resource` 必须填 chat channel URI（`ahp-chat://`），不能填 session URI（`opencode:/`），否则 `AgentHostStateManager` 会抛 `"Chat action dispatched to non-chat channel"`。
4. **`chatChannelUri` 空实现**: `createChat` 返回 `void`（无多 chat）、`fork` 抛错。如需支持多 chat，需参考 Copilot/Claude 在 `AgentSessionEntry` 中维护 `_chats: DisposableMap<string, ...>`。
5. **硬编码模型列表**: 和 Codex/Claude 通过 SDK 动态获取模型不同，OpenCode 使用静态 `OPENCODE_MODELS` 数组。需要改为通过 `opencode` CLI 或 REST API 动态查询。
6. **登录跳过**: `getProtectedResources()` 返回 `[]`、`authenticate()` 返回 `true`。这是 fork 专用修改（详见 `test-workbench_change` 标记），上游集成的 OpenCode agent 可能需要 GitHub 登录才能获取 API 额度。

---

## 3. 当前支持的效果

| 功能                    | 状态 | 说明                                                                                                             |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| 基本聊天 (send/receive) | ✅   | 支持流式文本响应                                                                                                 |
| 流式文本输出            | ✅   | SSE`message.part.delta` 实时推送，`ChatDelta` 逐字渲染                                                       |
| 多 session              | ✅   | 每个会话独立`opencode` session                                                                                 |
| abort 取消              | ✅   | `AbortController` + `fetch` signal                                                                           |
| reasoning (思维链) 显示 | ✅   | SSE 判别 part 类型，reasoning 走`ChatReasoning`                                                                |
| Tool Call 展示          | ✅   | SSE/HTTP 解析`ToolPart`，发 `ChatToolCallStart` + `ChatToolCallReady`（带入参） + `ChatToolCallComplete` |
| Tool 入参显示           | ✅   | 提取`state.input` 中 path/command/pattern 作为 `invocationMessage` 和 `toolInput`                          |
| bash 工具终端样式       | ✅   | `_meta.toolKind: 'terminal'`                                                                                   |
| token usage 统计        | ✅   | 从最终 JSON 提取`info.tokens`                                                                                  |
| session 持久化          | ✅   | opencode 自己管理`/session/`                                                                                   |
| session 恢复列表        | ✅   | `listSessions()` 通过 `GET /session/`                                                                        |
| 动态模型发现            | ✅   | `GET /provider` 自动获取，含 `maxContextWindow`/`maxOutputTokens`/`supportsVision`                       |
| 用户消息回显过滤        | ✅   | `_userPrompt` 记录用户输入，SSE/HTTP 回显自动跳过                                                              |

---

## 4. 当前不支持的效果

| 功能                                       | 说明                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Permission 弹窗确认**              | `respondToPermissionRequest` 是 stub（TODO），`onClientToolCallComplete` 空实现                      |
| **模型切换 (changeModel)**           | 通过`_sessionModels` + `session.setModel()` 传递 `{ providerID, modelID }` 到 `sendMessage` body |
| **多 Chat / Fork**                   | `chats.createChat` 返回 void，`chats.fork` 抛错                                                      |
| **Message 历史**                     | `getMessages()` 返回 `[]`，刷新后看不到历史对话                                                      |
| **Session 配置 (config)**            | `resolveSessionConfig` 返回空 schema                                                                   |
| **Attachment 附件**                  | `sendMessage` 只传 `prompt` 文本，忽略 `_attachments`                                              |
| **workingDirectory**                 | `OpenCodeSession` 构造接收 `workingDirectory`，所有 HTTP 请求带上 `?directory=` query param        |
| **changeAgent**                      | 空实现                                                                                                   |
| **sessionConfigCompletions**         | 返回空 items                                                                                             |
| **peer chat 恢复 (materializeChat)** | 未实现`IAgent.materializeChat`                                                                         |

---

## 5. 待改进项

### 高优先级

1. ~~**流式 JSON 解析改用 NDJSON**~~ ✅ 已改善

   - 现状: 流式 JSON unescape 改用 `JSON.parse('"' + raw + '"')`，SSE `message.part.delta` 提供实时增量，不再仅依赖正则。完全 NDJSON 需要 opencode 后端配合。
2. ~~**Tool Call 支持**~~ ✅ 已实现

   - `getOrCreateActiveClient` 使用 `ActiveClientToolSet` 跟踪 client tools，`setServerToolHost` 接收 server tools
   - `_getEnabledToolNames` 合并 tools 传入 HTTP 请求 body
   - SSE + HTTP 解析 `ToolPart`，映射为 `ChatToolCallStart` → `ChatToolCallReady` → `ChatToolCallComplete`
3. **Message 历史**

   - 现状: `getMessages()` 返回 `[]`，chat 刷新后无历史
   - 方案: 调用 `GET /session/:id/messages` 或 opencode SDK 获取历史，映射为 `Turn[]`

### 中优先级

4. **传输改为 stdio JSON-RPC**

   - 现状: HTTP REST + SSE，依赖端口解析 + `fetch`
   - 方案: 参考 Codex 的 `transportFromChildProcess`，用 stdio JSON-RPC 替代
5. ~~**动态模型获取**~~ ✅ 已实现

   - `_fetchModels()` 连接建立后自动调用 `GET /provider` 获取模型列表
   - 映射 `Provider.Model` → `IAgentModelInfo`（包含 `maxContextWindow`、`maxOutputTokens`、`supportsVision` 等可选字段）
   - 失败时静默回退到硬编码列表
6. **Permission 支持**

   - 现状: `respondToPermissionRequest` 是 TODO
   - 方案: 解析 opencode 的 permission SSE 事件（`permission.asked`），发射 `pending_confirmation` signal

### 低优先级

7. **多 Chat / Fork**

   - 现状: stub 实现
   - 方案: 参考 Copilot 的 `AgentSessionEntry` + `_chats` DisposableMap 模式
8. ~~**模型切换**~~ ✅ 已实现

   - `changeModel` 通过 `_resolveModelRef` 匹配模型列表获取 `providerID`，存入 `_sessionModels`
   - `sendMessage` 从 `_sessionModels` 取出 `{ providerID, modelID }` 写入请求 body
9. ~~**Attachment / workingDirectory 传递**~~ ✅ 已实现

   - `OpenCodeSession` 接收 `workingDirectory`，所有 HTTP 请求通过 `?directory=` query param 传递
   - 模型通过 `sendMessage` body 的 `model` 字段传递

---

## 6. 协议适配模式

### 6.1 问题背景

Agent Host Protocol (AHP) 定义了 client（UI 前端）与 agent host 之间的同步协议。但现有的 AI agent（Claude、Copilot、Codex）官方并没有直接支持 AHP——因此需要在 VS Code 侧做协议适配。

### 6.2 `IAgent` 适配层

VS Code 在 orchestrator 层（`AgentService` + `AgentHostStateManager`）和具体 agent 之间插入了 `IAgent` 这个内部接口：

```
UI ← AHP → AgentService(编排层) ← IAgent → ClaudeAgent/CopilotAgent/CodexAgent/OpenCodeAgent ← 各自 SDK/HTTP → Claude/Copilot/Codex/OpenCode
```

- `AgentService` + `AgentHostStateManager` 是 AHP 状态机，负责 reducer、状态管理、action 编排
- 每个 agent 都实现 `IAgent` 接口（定义在 `agentService.ts`），而非 AHP 协议
- agent 只需关注如何将 `IAgent` 翻译成自己的后端调用——OpenCodeAgent 就是通过 `IAgent` → HTTP REST/SSE 适配来连接 opencode

两层翻译的链路：

```
AHP ←→ AgentService ←→ IAgent ←→ OpenCodeAgent(实现 IAgent) ←→ HTTP/SSE ←→ opencode
       ↑ 编排层在 AHP↔IAgent 之间翻译      ↑ OpenCodeAgent 在 IAgent↔HTTP 之间翻译
```

OpenCodeAgent 在 VS Code 侧做了完整的 `IAgent` → HTTP 适配：

- `openCodeAgent.ts` — 实现 `IAgent` 接口（session 生命周期、agent 路由）
- `openCodeSession.ts` — 将 `sendMessage` 等 `IAgent` 操作翻译为 `POST /session/:id/message`
- `openCodeEventStream.ts` — 将 SSE 事件流翻译为 `AgentSignal` 回传给编排层

这样做的代价：每个新 agent 接入都需要实现 `IAgent` 适配层，且 agent 方无法直接复用自己的 AHP 能力。

<!--
  OPENCODE_INTEGRATION.md — OpenCode Agent 集成方案总结
  对应代码: src/vs/platform/agentHost/node/openCode/
-->

# OpenCode Agent 集成方案

> **状态: V1 功能对齐完成** (2026-09-17)
> 聊天、流式、工具调用、permission 确认、历史/截断、多 chat/fork/sideChat、
> 会话配置(permissionMode)、恢复重挂(materializeChat)、外部会话发现
> (onDidDiscoverChats)、子代理 spawn 通道均已接入并对齐 Claude/Codex 的
> 上游契约。剩余差距见 §4。

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
| **多 chat 支持**          | `createChat`→独立 opencode 会话      | ✅                                         | ✅                                 | ✅                            |
| **Fork**                  | `POST /session/:id/fork` ✅(含 turn 锚点) | ✅                                         | ✅                                 | ✅                            |
| **tool call 模型**        | ✅ SSE + HTTP                      | SDK 处理                                   | SDK 处理                           | JSON-RPC request/notification |
| **模型发现**              | `GET /provider` 动态获取         | SDK`models.list`                         | SDK`models.list`                 | SDK 内建                      |
| **认证**                  | `OPENCODE_AUTH` env / Basic auth | GitHub token (CAPI)                        | API key / CAPI proxy               | GitHub token + local proxy    |
| **文件操作**              | ❌ (opencode 自行处理)             | CopilotApiService (CAPI)                   | SDK 内建                           | codex 二进制自己处理          |
| **permission**            | `permission.asked` → 原生确认框 ✅   | SDK 内建                                   | SDK 内建                           | JSON-RPC requestApproval      |

### 注意事项

1. **与 Codex 传输差异**: Codex 用 `child_process.spawn` + **stdio JSON-RPC (NDJSON)**，OpenCode 用 **HTTP REST + SSE**。两者的共同点是都 spawn 子进程，但 Codex 走 stdio 管道（更可靠，不需要端口探测），OpenCode 走 HTTP（依赖 `--port=0` + stdout 正则匹配，脆弱）。
2. **与 Copilot 传输差异**: Copilot 的 `RuntimeConnection.forStdio()` 封装了 SDK 的 stdio JSON-RPC，OpenCode 直接调用 `fetch()`。后续优化方向应改为 stdio JSON-RPC。
3. **`chatChannelUri` 处理**: 和其他 agent 一样，必须使用 `ahp-chat://default/<base64(sessionUri)>` 格式（`buildDefaultChatUri`）。`_fireAction` 的 `resource` 必须填 chat channel URI（`ahp-chat://`），不能填 session URI（`opencode:/`），否则 `AgentHostStateManager` 会抛 `"Chat action dispatched to non-chat channel"`。
4. **多 chat / fork**: `chats.createChat`（含 `options.fork`）为每个 chat 创建/派生独立 opencode 会话；`providerData` 统一为 opencode 会话 ID，`materializeChat` 按它重挂；返回 `backingSession` 让 orchestrator 抑制内部 backing（I7，防 fork backing 泄漏为幽灵顶层 session）。`capabilities.multipleChats: { fork: true, sideChat: true }` 已声明，sideChat 由 host 解析为 fork（`IAgentCreateChatRequestOptions` 契约）。

5. **turn id 翻译**: live turn 的 host turnId（orchestrator mint 的 uuid）与 opencode 后端消息 ID 不同域。session 经 `message.updated`/轮询登记 `_hostTurnAnchors`（host turnId → 本轮最新后端消息 id），fork 锚点与 `truncateChat` 先查此映射、miss 时按 id 原样兜底（restore 后 `getMessages` 的 `Turn.id` 即后端消息 id）。与 Codex `codexTurnIdByHostTurnId` 同构。
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
| Permission 弹窗确认     | ✅   | SSE `permission.asked` → `pending_confirmation` signal → `POST /permission/:id/reply`（owner session 定向回包） |
| 多 Chat / Fork          | ✅   | `createChat(options.fork)` 派生独立会话（turn 锚点翻译）；`backingSession` 标记符合 I7                     |
| Message 历史            | ✅   | `getMessages()` → `GET /session/:id/message` 映射为 `Turn[]`，刷新可见                                    |
| 历史截断 (truncateChat) | ✅   | 保留至锚点、删除其后消息（`DELETE /session/:id/message/:messageID`），对齐 Codex thread/rollback 语义     |
| 会话配置 (permissionMode) | ✅ | `resolveChatConfig` 广告 default/acceptEdits/bypassPermissions，经 `PATCH /session/:id { permission }` 下发 |
| 附件                    | ✅   | `MessageAttachment` → opencode file parts（Resource URI / Embedded base64）                              |
| Try Again (resumeTurn)  | ✅   | 失败 turn 以原 turnId 重发（prompt_async 续接）                                                            |
| Slash 命令              | ✅   | 命中 `GET /command` 清单时走 `POST /session/:id/command`                                                  |
| 外部会话发现            | ✅   | `onDidDiscoverChats`：枚举 `GET /session/`（排除子会话/归档），registry+本地映射过滤，`external: true` 推入；lazy（后端激活后补发） |
| 子代理 spawn 通道       | ✅   | `task` part `metadata.sessionId` → `subagent_started` signal + 只读 backing 登记；冷恢复从父 transcript 反查重挂 |
| Fork 锚点边界           | ✅   | host turnId → 消息锚点 → 后端 exclusive boundary 取锚点下一条（修复丢末条消息的语义偏差） |
| Fork 继承               | ✅   | 新 fork chat 继承源会话工作目录/模型/agent（对齐 Codex 语义，不再落合成 /tmp 目录） |
| Metadata 完整性         | ✅   | `getChatMetadata` 返回 `workingDirectories`/`model`（外部会话 restore 解析工作根所需） |
| 生命周期级联            | ✅   | `releaseSession`/`disposeSession` 级联 peer/fork backing；`_request` 携带 `x-opencode-directory` 路由头 |

---

## 4. 与 Claude/Codex 的剩余差距

| 功能 | 说明 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **多根工作区** | `workingDirectories` 仅取 index 0（opencode 后端单根），未声明 `multipleWorkingDirectories` |
| **permission always 级别** | 上游 `IAgent.respondToPermissionRequest(requestId, approved: boolean)` 只有布尔位，无法把 UI 的 "always allow" 透传给 `reply: 'always'`；当前按 once/reject 映射 |
| **模型 reasoning-effort 配置** | 后端 `PromptInput.thinkingEnabled` 是布尔，provider 侧无 per-model effort 枚举，`IAgentModelInfo` 不带 `configSchema` |
| **auth 旁路** | `getProtectedResources()` 返回 `[]`、`authenticate()` 恒 true（fork 专用，`test-workbench_change` 标记） |
| **传输脆弱性** | 仍为 HTTP REST + SSE（`--port=0` + stdout 正则），Codex 为 stdio JSON-RPC（NDJSON） |

---

## 5. 待改进项

### 高优先级

1. ~~**流式 JSON 解析改用 NDJSON**~~ ✅ 已改善（SSE `message.part.delta` 主导 + 轮询兜底）
2. ~~**Tool Call 支持**~~ ✅ 已实现（`ChatToolCallStart` → `Ready` → `Complete` 状态机）
3. ~~**Message 历史**~~ ✅ 已实现（`getMessages()` → `GET /session/:id/message` → `Turn[]`）
4. ~~**Permission 支持**~~ ✅ 已实现（`permission.asked` → `pending_confirmation`；`respondToPermissionRequest` 按 `_pendingAskIds` owner 定向回包，不再广播）
5. ~~**多 Chat / Fork / 恢复**~~ ✅ 已实现（`createChat`/`options.fork`、`truncateChat`、`materializeChat`、`backingSession`/I7、capabilities 声明）
6. ~~**会话配置**~~ ✅ 已实现（`resolveChatConfig` 广告 `permissionMode`，`PATCH /session/:id { permission }` 在创建/fork/config 变化时下发）

### 下一轮（本轮已完成 ✅）

7. ~~**外部会话发现**~~ ✅ 已实现（`onDidDiscoverChats` Emitter + `startChatDiscovery`/`setKnownSessionsFilter` seam；lazy：仅后端已激活时枚举，不单独 spawn。排除 `parentID` 子会话与归档；`listChatsToMigrate` 返回 known 半，未激活返回 `AgentChatMigrationDeferred`）
8. ~~**子代理 spawn 通道**~~ ✅ 已实现（`task` part 的 `state.metadata.sessionId` 落地 → 登记 subagent 只读 backing（`buildSubagentChatUri` 寻址）+ fire `subagent_started` signal，host 共享 converter `_sequenceSpawnedChat` 建目录；冷恢复 `materializeChat` subagent 分支从父 transcript 反查 callID→子会话 id）
9. **传输改为 stdio JSON-RPC**：后端仅有 HTTP 面，需先给 testagent-core 加 stdio transport，再参考 Codex `transportFromChildProcess` 替换。

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

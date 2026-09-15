# OpenCode Agent V1 — 功能补齐计划

> **Handoff plan** — written to be executed by an agent with no prior conversation context. All file paths and line citations are verified against the workspace at synthesis time. See [OPENCODE_INTEGRATION.md](../../OPENCODE_INTEGRATION.md) for architecture overview.

## Overview

当前 OpenCodeAgent（`openCodeAgent.ts` 587行, `openCodeSession.ts` 514行, `openCodeEventStream.ts` 182行）仅实现了基础聊天、流式输出和工具调用展示。V1 补齐四个功能后，总代码量预计增长至 ~1,600 行，不新增文件。

| Phase | 功能 | 当前状态 | 目标 | 估量 |
|-------|------|---------|------|------|
| 1 | Message 历史 | `getMessages()` 返回 `[]` | `GET /session/{id}/message` → `Turn[]` | ~100 行 |
| 2 | Attachment 附件 | `sendMessage` 忽略 `_attachments` | `MessageAttachment[]` → opencode `FilePart[]` | ~65 行 |
| 3 | Permission 弹窗 | `respondToPermissionRequest` 空实现 | `permission.asked` SSE → UI 弹窗 → `POST /permission/{id}/reply` | ~110 行 |
| - | SSE 增强 | `handleEvent` 只处理 2 种事件 | 新增 `permission.asked`、`session.idle` 等类型 | ~45 行 |
| 4 | Session Config | `resolveSessionConfig` 返回空 schema | 构建实际 config schema，支持 model 选择 | ~120 行 |

---

## Phase 1 — Message 历史

### 1.1 Goal

`getMessages(chat: URI)` 和 `getSessionMessages(sessionUri: URI)` 返回 opencode 的完整对话历史，刷新后可见。

### 1.2 OpenCode API

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/session/{sessionID}/message` | 返回 `[{info: Message, parts: Part[]}]` |

Response schema:
- `Message` = `UserMessage | AssistantMessage`
- `UserMessage` — `{id, sessionID, role: "user", time, agent, model}`
- `AssistantMessage` — `{id, sessionID, role: "assistant", time, parentID, modelID, providerID, mode, cost, tokens, error?}`
- `Part` = `TextPart | ReasoningPart | ToolPart | FilePart | StepStartPart | StepFinishPart | ...`
- `ToolPart` — `{callID, tool, state: ToolState}`
- `ToolState` — `{status: "pending"|"running"|"completed"|"error", input, output?, error?}`

### 1.3 IAgent 契约

```
IAgentChats.getMessages(chat: URI): Promise<readonly Turn[]>
IAgent.getSessionMessages(sessionUri: URI): Promise<readonly Turn[]>
```

`Turn` 类型（`state/protocol/channels-chat/state.ts:494`）：
```ts
interface Turn {
    id: string;
    startedAt?: string;
    duration?: number;
    message: Message;
    responseParts: ResponsePart[];
    usage?: { ... };
}
```

### 1.4 文件改动

| Action | File | Purpose |
|--------|------|---------|
| **Modify** | `openCodeSession.ts` | 实现 `getMessages()` → `GET /session/{opencodeId}/message`，映射 OpenCode `Message[]` + `Part[]` → VS Code `Turn[]` |
| **Modify** | `openCodeAgent.ts` | `chats.getMessages` 和 `getSessionMessages` 代理给 session |

### 1.5 映射逻辑

```
GET /session/{id}/message → [{info, parts}]
  → 遍历 messages:
      info.role === "user" → 新 Turn，message = { kind: MessageKind.User, text: 拼接 text parts }
      info.role === "assistant" → 追加 responseParts:
        - TextPart → ResponsePartKind.Markdown
        - ReasoningPart → ChatReasoning action 数据追记到 responseParts
        - ToolPart → 对应 Turn 的 ToolCall 记录（start/complete）
        - FilePart → 附件展示
      usage 从 AssistantMessage.tokens 提取
```

关键点：
- `Turn.id` = opencode Message `id`
- ToolCall 状态从 `ToolState.status` 推导
- usage 从 `AssistantMessage.tokens` 计算

### 1.6 Exit criteria

`getMessages(chatUri)` 返回非空 `Turn[]`，刷新 chat 面板后可见历史对话。

---

## Phase 2 — Attachment 附件

### 2.1 Goal

`sendMessage` 支持 `MessageAttachment[]` 参数，将附件转换为 opencode 的 `FilePartInput` 格式传递。

### 2.2 OpenCode API

`POST /session/{sessionID}/message` body 的 `parts` 数组支持：
```json
{ "type": "file", "mime": "image/png", "url": "data:image/png;base64,...", "filename": "screenshot.png", "source": {...} }
```

### 2.3 MessageAttachment 类型

```ts
type MessageAttachment =
    | SimpleMessageAttachment       // { kind: 'simple', label, modelRepresentation? }
    | MessageEmbeddedResourceAttachment  // { kind: 'embeddedResource', data, contentType, label }
    | MessageResourceAttachment     // { kind: 'resource', uri, label, selection? }
    | MessageAnnotationsAttachment; // { kind: 'annotations', resource, annotationIds? }
```

### 2.4 文件改动

| Action | File | Purpose |
|--------|------|---------|
| **Modify** | `openCodeSession.ts` | `sendMessage` 新增 `_attachments?` 参数，转换为 opencode file parts 合并到 body |

### 2.5 转换映射

| MessageAttachment 类型 | → opencode Part |
|---|---|
| `Simple` (文本) | `{type: "text", text: modelRepresentation}` |
| `EmbeddedResource` (base64) | `{type: "file", mime: contentType, url: "data:..."}` |
| `Resource` (文件引用) | 读取文件内容 → `{type: "file", mime, url: dataURI, filename, source}` |
| `Annotations` | 渲染为文本 → `{type: "text"}` |

参考：Copilot `_toSdkAttachment()`（`copilotAgentSession.ts:1534-1581`）。

### 2.6 Exit criteria

`sendMessage` 携带附件时，opencode 收到正确的 `parts` 数组，AI 能引用附件内容。

---

## Phase 3 — Permission 弹窗

### 3.1 Goal

opencode 工具调用前弹出 VS Code 原生确认框，用户 approve/deny 后继续或拒绝执行。

### 3.2 OpenCode API

| 方向 | 方式 | 详情 |
|------|------|------|
| opencode → VS Code | SSE `permission.asked` | `{id, sessionID, permission, tool: {callID, messageID}}` |
| VS Code → opencode | `POST /permission/{requestID}/reply` | body: `{reply: "once"\|"always"\|"reject"}` |

### 3.3 数据流

```
opencode SSE → permission.asked → handleEvent
  → 构建 pending_confirmation AgentSignal → _onProgress.fire()
  → AgentSideEffects._handleAgentSignal → AgentHostStateManager
  → dispatchServerAction → SessionToolCallPending action → UI 弹窗
  → 用户 Approve/Deny → respondToPermissionRequest(id, true/false)
  → POST /permission/{id}/reply
  → opencode 继续/拒绝执行
```

### 3.4 SSE 事件增强（Phase 3 前置）

| 任务 | 说明 | 文件 |
|------|------|------|
| 扩展 `handleEvent` | 新增 `permission.asked`、`session.idle` 事件类型分发 | `openCodeSession.ts` |
| `OpenCodeEventStream` 事件通过 sessionID | 当前通过 `properties.sessionID` 路由，`permission.asked` 的 properties 已包含 `sessionID` | 已兼容 |

### 3.5 文件改动

| Action | File | Purpose |
|--------|------|---------|
| **Modify** | `openCodeSession.ts` | `handleEvent` 捕获 `permission.asked` → 存 `_pendingPermissions: Map<requestId, DeferredPromise>` → 发射 `pending_confirmation` signal；新增 `_buildPendingConfirmationSignal()` |
| **Modify** | `openCodeSession.ts` | `respondToPermissionRequest()` → `POST /permission/{id}/reply` |
| **Modify** | `openCodeAgent.ts` | `respondToPermissionRequest` 遍历 sessions 分发 |

### 3.6 PermissionRequest → SessionToolCallReady 映射

```ts
// opencode 的 permission.asked event
{
  id: "per_xxx",
  sessionID: "ses_xxx",
  permission: "bash",        // 权限类型
  tool: { callID: "tool_xxx", messageID: "msg_xxx" }
}

// → VS Code 的 pending_confirmation signal
{
  kind: 'action',
  resource: chatChannelUri,
  action: {
    type: ActionType.SessionToolCallReady,
    session: sessionUri,
    toolCallId: permissionRequest.id,    // 用 permission request id
    toolName: permissionRequest.permission,
    state: { kind: 'pending_confirmation', ... }
  }
}
```

### 3.7 approve/deny 映射

`respondToPermissionRequest(requestId, approved: boolean)`:
- `approved === true` → `POST /permission/{id}/reply` body `{reply: "once"}`
- `approved === false` → `POST /permission/{id}/reply` body `{reply: "reject"}`
- V1 暂不区分 `once` 和 `always`

### 3.8 Exit criteria

opencode 执行 bash 工具时弹出确认框，用户 approve 后继续执行，deny 后拒绝。

---

## Phase 4 — Session Config

### 4.1 Goal

支持会话创建时选择 model、配置 permission rules。`resolveSessionConfig` 返回实际 schema 而非空对象。

### 4.2 OpenCode API

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/provider` | provider + model 列表，含 capabilities、limits |
| `POST` | `/session/` | 创建时可传 `{model: {id, providerID}, permission: PermissionRule[]}` |
| `PATCH` | `/session/{sessionID}` | 更新 `{title, permission}` |

`PermissionRule` = `{permission: string, pattern: string, action: "allow"|"deny"|"ask"}`

### 4.3 IAgent 契约

```
resolveSessionConfig(params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult>
  → { schema: SessionConfigSchema, values: Record<string, unknown> }

sessionConfigCompletions(params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult>
  → { items: SessionConfigValueItem[] }
```

### 4.4 文件改动

| Action | File | Purpose |
|--------|------|---------|
| **Modify** | `openCodeAgent.ts` | `resolveSessionConfig` 构建实际 schema（mode, model selection, autoApprove level） |
| **Modify** | `openCodeAgent.ts` | `sessionConfigCompletions` 返回 `{items: []}`（暂无动态枚举） |
| **Modify** | `openCodeAgent.ts` | `createSession` 时将 model + permission 写入 `POST /session/` body |
| **Modify** | `openCodeSession.ts` | `initialize()` body 新增 model、permission 字段 |

### 4.5 Schema 定义

```ts
const sessionSchema = createSchema({
    [SessionConfigKey.Mode]: schemaProperty<SessionMode>({
        type: 'string',
        title: 'Mode',
        enum: ['interactive'],
        enumLabels: ['Interactive'],
        default: 'interactive',
    }),
    [SessionConfigKey.AutoApprove]: schemaProperty<AutoApproveLevel>({
        type: 'string',
        title: 'Auto Approve',
        enum: ['default', 'tools', 'all'],
        enumLabels: ['Default', 'Safe Tools', 'All'],
        enumDescriptions: ['Ask every time', 'Auto-approve safe tools', 'Auto-approve everything'],
        default: 'default',
    }),
});
```

AutoApprove → opencode permission 映射：
- `default` → 不传 permission rules（opencode 用自身配置）
- `tools` → 传 `[{action: "allow", permission: "read"}, ...]`
- `all` → 传 `[{action: "allow", permission: "read"}, {action: "allow", permission: "edit"}, {action: "allow", permission: "bash"}, ...]`

### 4.6 Exit criteria

`resolveSessionConfig` 返回非空 schema，创建 session 时可选择 model 和 auto-approve 级别。

---

## 附加改进

### SSE 事件覆盖度

| 事件类型 | 当前状态 | V1 目标 |
|----------|---------|---------|
| `message.part.updated` | ✅ 已处理 | — |
| `message.part.delta` | ✅ 已处理 | — |
| `permission.asked` | ❌ | ✅ Phase 3 处理 |
| `session.idle` | ❌ | ✅ 用于 Turn 完成判断 |
| `session.error` | ❌ | ✅ 用于错误展示 |
| 其他事件 | ❌ | silent ignore + warn log |

### 错误处理加强

- 未知 SSE 事件类型 → `_logService.warn()` + silent ignore
- 未知 opencode 消息 part 类型 → skip gracefully
- `getMessages()` 网络错误 → 返回 `[]` 而非 throw

---

## Exit criteria (整体 V1)

1. `getMessages(chatUri)` 返回完整历史对话
2. `sendMessage` 支持附件传递
3. 工具调用前弹出确认框，approve/deny 生效
4. 会话创建时可选 model 和 auto-approve 级别
5. 所有改动限定在 `openCodeAgent.ts` 和 `openCodeSession.ts` 两个文件
6. `test-workbench_change` 标记清晰

## 不改的东西

| 项 | 理由 |
|---|------|
| 多 Chat / Fork | V2 范围，需要 opencode 会话 fork API |
| changeAgent | V2 范围 |
| Message 删除 / Part 编辑 | 低优先级，非核心功能 |
| MCP Server 管理 | 当前 opencode 不支持 |
| peer chat 恢复 (materializeChat) | V2 范围 |

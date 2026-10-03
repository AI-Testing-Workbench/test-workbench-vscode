# OpenCode(testagent-core fork)接入 Agent Host 特性需求文档

> **文档状态**: Draft(评审中)
> **版本**: 0.2.0
> **日期**: 2026-10-03
> **相关代码**:
> - VS Code 侧适配层: `src/vs/platform/agentHost/node/openCode/`
> - opencode fork(testagent-core): `/Users/lujs/project/testagent-kilo/packages/testagent-core/`(核心代码在 `packages/opencode/src/`)
> - 协议定义: `src/vs/platform/agentHost/common/agentService.ts`(`IAgent` / `IAgentChats`)
> - 跨窗口会话切换方案见 **§10**(Agents 窗口 ↔ 编辑器 TestAgent 插件 handoff)

---

## 1. 背景与目标

### 1.1 背景

本仓库(fork 自 VS Code)已在 `src/vs/platform/agentHost/node/openCode/` 中实现了基于 HTTP REST + SSE 的 OpenCode 后端集成,支持基本聊天、流式文本、reasoning 思维链、token 统计、abort 取消、session 恢复列表等能力。

当前集成的 opencode 为官方二进制(`opencode serve --port=0`)。业务侧希望将后端替换为 **testagent-core**(opencode 的 fork 版本,含 kilo 定制路由与 worktree diff 等能力),以复用该 fork 的增量能力。

### 1.2 目标

1. 让 **testagent-core fork** 作为 agent host 的 OpenCode provider 后端,完全适配 agent host 协议(`IAgent` / `IAgentChats` / `AgentSignal`);
2. 补齐当前适配层缺失的协议能力:会话历史恢复、权限确认、用户输入(ask_user)、fork、动态模型列表、模型切换、多 chat 等;
3. **不改动 fork 内部业务路由**(如 `testagent` 组、worktree diff),只做桥接式对齐;
4. 使 OpenCode provider 在功能完整度上对齐 Copilot / Claude / Codex provider。

### 1.3 非目标

- 不改造 testagent-core 的 AI 模型调用、工具执行、TUI 等内部逻辑;
- 不将 fork 的 HTTP API 改为 stdio JSON-RPC(传输层优化列为远期可选,见 §8.1);
- 不实现 fork 自身没有的能力(如子 agent 会话编排,若 fork 不支持则跳过)。

---

## 2. 现状分析

### 2.1 现有集成架构

```
Chat UI → IPC → AgentService → AgentSideEffects → OpenCodeAgent.chats.sendMessage
    → OpenCodeSession → HTTP POST localhost(opencode serve)
    → opencode SSE 事件 → OpenCodeEventStream → OpenCodeSession.handleEvent
    → AgentSignal → AgentHostStateManager → IPC → UI 渲染
```

### 2.2 当前协议能力缺口(IAgent / IAgentChats 对照)

| 协议成员 | 当前实现 | 缺口 |
|---|---|---|
| `chats.sendMessage` | ✅ 可用 | 忽略 `attachments` 与 `workingDirectory` |
| `chats.abort` | ✅ 可用 | — |
| `chats.createChat` | ❌ 恒 `Promise.resolve()` | 多 chat 未实现 |
| `chats.fork` | ❌ `reject('Fork not supported')` | fork 未实现 |
| `chats.disposeChat` | ❌ 空实现 | 多 chat 未实现 |
| `chats.changeModel` | ❌ 空实现 | 模型切换未实现 |
| `chats.changeAgent` | ❌ 空实现 | 依赖 fork 能力,待评估 |
| `chats.getMessages` | ❌ 恒返回 `[]` | 历史恢复未实现 |
| `getSessionMessages` | ❌ 恒返回 `[]` | 同上 |
| `resolveSessionConfig` | ❌ 空 schema | 会话配置未实现 |
| `sessionConfigCompletions` | ❌ 空 items | 配置补全未实现 |
| `respondToPermissionRequest` | ❌ TODO stub | 权限确认未实现 |
| `respondToUserInputRequest` | ❌ 空实现 | ask_user 未实现 |
| `models` | ⚠️ 硬编码 3 个模型 | 应动态获取 |
| `materializeChat` | ❌ 未实现 | 会话恢复未实现 |
| `onDidSpawnChat` / `getSubagentSessions` | ❌ 未实现 | 子 agent 未实现 |
| `setPendingMessages` | ❌ 未实现 | steering 消息未实现 |
| `releaseSession` | ❌ 未实现 | 空闲回收未实现 |
| `getProtectedResources` / `authenticate` | 返回 `[]` / 恒 `true` | fork 有意跳过登录,保留 |

### 2.3 fork(testagent-core)侧能力盘点(已具备)

对照协议需求,testagent-core 的 HTTP API 层已覆盖绝大多数能力:

| 协议能力 | fork 现有端点 | 代码位置 |
|---|---|---|
| 会话历史 | `GET /session/:id/message`、`GET /api/session/:id/message`(v2) | `server/routes/instance/httpapi/groups/session.ts` L178、`groups/v2/message.ts` |
| 创建/发消息 | `POST /session`、`POST /session/:id/message`、v2 `POST /api/session/:id/prompt` | `groups/session.ts` L201/306、`groups/v2/session.ts` L83 |
| fork 会话 | `POST /session/:id/fork` | `groups/session.ts` L235 |
| abort | `POST /session/:id/abort` | `groups/session.ts` L247 |
| 权限确认 | `GET /permission`、`POST /permission/:requestID/reply` | `groups/permission.ts` L28/37 |
| 用户输入 | `GET /question`、`POST /question/:requestID/reply`、`POST /question/:requestID/reject` | `groups/question.ts` L21/30/42 |
| 模型/供应商 | `GET /provider`(含 OAuth) | `groups/provider.ts` L17 |
| SSE 事件流 | `GET /event`(text/event-stream) | `event.ts` |
| 子会话 | `GET /session/:id/children` | `groups/session.ts` L145 |

### 2.4 事件流兼容性(关键验证点)

```
fork 侧:   Bus Payload = { id, type, properties }
           SSE 输出    = { event: "message", data: JSON.stringify({id, type, properties}) }

VS Code 侧: OpenCodeEventStream._parseSSEEvent
           data → JSON.parse → { type, properties }        ✅ 结构兼容
           properties.sessionID → _findSessionByOpencodeId 路由 ✅(需确认 fork 事件含 sessionID 字段)
```

---

## 3. 目标架构

### 3.1 改造后架构

```
Chat UI → IPC → AgentService → AgentSideEffects → OpenCodeAgent.chats.*
    │
    ├── sendMessage / abort / getMessages / fork / createChat / changeModel
    │       │
    │       ▼
    │   OpenCodeSession ──HTTP──▶ testagent-core fork (localhost)
    │                              ├─ POST /session、/session/:id/message
    │                              ├─ GET  /session/:id/message  (历史)
    │                              ├─ POST /session/:id/fork
    │                              ├─ POST /permission/:requestID/reply
    │                              └─ POST /question/:requestID/reply
    │
    └── SSE: /event ──▶ OpenCodeEventStream ──▶ OpenCodeSession.handleEvent
             (fork type 命名空间 → handler 映射表)
             → AgentSignal(action / pending_confirmation)
             → AgentHostStateManager → IPC → UI
```

### 3.2 改造原则

1. **桥接而非改造 fork**:fork 只提供原始能力,所有协议翻译逻辑放 VS Code 侧,避免双向耦合;
2. **以 agent host 协议为基准**:`IAgent` / `IAgentChats` 是唯一契约,不反向适配 fork;
3. **增量最小化**:fork 侧只确认/补充缺失端点,不动内部业务路由;
4. **向后兼容**:未改造前,现有 `sendMessage` / `abort` / 基础聊天保持可用。

---

## 4. 改造方案

### 4.1 总体工作量分配

| 改造对象 | 工作量占比 | 说明 |
|---|---|---|
| VS Code 侧 `OpenCodeSession` | ~60% | 历史恢复、事件翻译、请求体对齐 |
| VS Code 侧 `OpenCodeAgent` | ~25% | 权限信号、fork/多 chat、动态模型 |
| fork(testagent-core)侧 | ~15% | 模型切换端点、事件 payload 确认/补齐 |

### 4.2 事件流映射方案(核心)

在 `OpenCodeSession.handleEvent()` 中新增 **fork type → handler 映射表**,将 fork 的 Bus 事件类型翻译为 VS Code 协议动作:

| fork 事件 type(待实测确认) | 映射到 | 对应方法 |
|---|---|---|
| `message.part.updated`(text/reasoning 等) | `ActionType.ChatResponsePart` | `_handlePartUpdated` |
| `message.part.delta` | `ActionType.ChatResponsePart`(增量) | `_handlePartDelta` |
| `message.part.tool` 相关 | `ChatToolCallStart/Delta/Complete` | `_handleToolPartEvent` |
| `session.permission.requested`(或类似) | `IAgentToolPendingConfirmationSignal` | 新增 handler |
| `session.question.asked`(或类似) | `respondToUserInputRequest` 通道 | 新增 handler |

> 具体 type 字符串需在 fork 的 `packages/opencode/src/bus/` 与 `session/` 下实测确认(见 §7 验证步骤)。

### 4.3 `OpenCodeSession` 改造清单

| 方法 | 改造内容 |
|---|---|
| `getMessages()` | 调用 fork `GET /session/:id/message`(或 v2 `GET /api/session/:id/message`),将 Message/Part 表结构转换为协议 `Turn[]`,新增 `forkMessageToTurn()` 转换函数 |
| `sendMessage()` | 请求体对齐 fork `{ parts: [{type:'text', text}], tools }` 结构;在请求体中补传 `workingDirectory` 与 `attachments` |
| `respondToPermissionRequest()` | 调用 fork `POST /permission/:requestID/reply` |
| `respondToUserInputRequest()` | 调用 fork `POST /question/:requestID/reply`(或 `/reject`) |
| `handleEvent()` | 引入 §4.2 映射表,补充 permission / question 事件分支 |

### 4.4 `OpenCodeAgent` 改造清单

| 成员 | 改造内容 |
|---|---|
| `chats.createChat` | 每个 chat URI 映射一个 fork 会话(利用 fork 多会话能力) |
| `chats.fork` | 调用 fork `POST /session/:id/fork`,返回新会话 URI |
| `chats.disposeChat` | 调用 fork `DELETE /session/:id` |
| `chats.changeModel` | 调用 fork 模型切换端点(见 §4.5) |
| `models` | 启动时从 `GET /provider` 拉取动态模型列表,替代硬编码 `OPENCODE_MODELS` |
| 权限信号 | 解析 fork permission 事件 → 发出 `IAgentToolPendingConfirmationSignal`(`kind: 'pending_confirmation'`),驱动 UI 确认弹窗 |
| `materializeChat` | 会话恢复时按 `providerData` 重挂 fork 会话 |

### 4.5 fork(testagent-core)侧改造清单

| 序号 | 改造内容 | 说明 |
|---|---|---|
| 1 | 确认 v1 路径兼容 | `groups/session.ts` 已有 `prompt: /session/:sessionID/message`(L96),与 VS Code 侧 `sendMessage` URL 一致,确认请求体结构即可 |
| 2 | 模型切换端点 | 确认 `update`(PATCH `/session/:id`)是否支持运行时换 model;不支持则在 `httpapi` 组内新增(只加不改内部业务) |
| 3 | 事件 payload 带 `sessionID` | 确认 fork Bus 事件 `properties` 含 `sessionID` 字段(VS Code 侧依赖它路由),缺则补齐 |
| 4 | 保持既有定制路由不动 | `testagent` 组、worktree diff 等 kilo 定制保持原样,避免破坏业务 |

---

## 5. 实施顺序(里程碑)

### 5.1 P0:基础功能完整性(核心)

> 目标:会话刷新不丢历史,基本体验完整。

| 任务 | 产出 |
|---|---|
| fork 事件 payload 实测(见 §7) | 确认 `type` / `properties.sessionID` / part 结构 |
| `OpenCodeSession.getMessages()` 历史恢复 | `forkMessageToTurn()` 转换器,对接 `GET /session/:id/message` |
| `sendMessage` 补传 `workingDirectory` / `attachments` | 请求体对齐 fork v1/v2 结构 |
| `handleEvent()` 引入 fork type 映射表 | 事件翻译落地 |

### 5.2 P1:交互能力对齐

> 目标:UI 权限弹窗、ask_user 可用。

| 任务 | 产出 |
|---|---|
| `respondToPermissionRequest` + 权限信号 | 调 `POST /permission/:requestID/reply`,发 `pending_confirmation` 信号 |
| `respondToUserInputRequest` | 调 `POST /question/:requestID/reply` |
| fork 侧确认/补齐事件 payload 字段 | 事件路由稳定 |

### 5.3 P2:高级能力对齐

> 目标:对齐 Copilot / Claude / Codex provider 的完整功能面。

| 任务 | 产出 |
|---|---|
| `chats.createChat` / `disposeChat` | 多 chat 支持 |
| `chats.fork` | 调 `POST /session/:id/fork` |
| 动态模型列表 | 对接 `GET /provider`,替换 `OPENCODE_MODELS` |
| `chats.changeModel` | 对接模型切换端点(见 §4.5-2) |
| `materializeChat` | 会话恢复重挂 fork 会话 |

---

## 6. 验收标准

### 6.1 P0 验收

- [ ] 新会话创建后,输入消息并等待回复,流式文本正常渲染;
- [ ] 关闭并重开会话(或刷新窗口),历史消息完整恢复(`getMessages` 非空);
- [ ] `sendMessage` 携带 `workingDirectory`,fork 侧在正确目录执行工具;
- [ ] attachment(如文件引用)能随消息传递并在 fork 侧生效。

### 6.2 P1 验收

- [ ] 模型请求工具权限时,UI 出现确认弹窗,允许/拒绝均可生效;
- [ ] fork 触发 `ask_user` 时,UI 能接收输入并回传;
- [ ] SSE 事件路由稳定,无 `sessionID` 匹配失败告警。

### 6.3 P2 验收

- [ ] 会话内可切换模型(动态列表 + 生效);
- [ ] 可创建/删除多 chat,可 fork 会话且历史继承;
- [ ] 重启后 `materializeChat` 恢复多 chat 会话。

---

## 7. 验证步骤(动手前必做)

> 目的:基于真实返回结构实现,避免按猜测改造。
> **优先方式**:fork 基于 Effect `HttpApi` 框架,内置 `GET /doc` 端点,返回 `OpenApi.fromApi(PublicApi)` 生成的完整 OpenAPI JSON 文档(聚合 Session / Permission / Question / Provider / Event / V2 等全部 group),**无需逐条 curl 猜测,直接取文档即可确认所有端点、请求体、返回结构与事件 schema**。

### 7.1 启动 fork

```bash
cd /Users/findly/testagent-kilo/packages/testagent-core
bun run dev
# 启动后查看日志中的监听地址:
#   opencode server listening on http://<hostname>:<port>
```

### 7.2 获取 OpenAPI 文档(优先)

```bash
# 1) 拉取完整 OpenAPI 规范(JSON,含所有端点 path/schema)
curl http://localhost:PORT/doc | jq . > opencode-api-doc.json

# 2) 按需过滤:查看 session/message/permission/question/provider/event 各端点
jq '.paths | keys' opencode-api-doc.json                                    # 全部端点路径
jq '.paths["/session"]' opencode-api-doc.json                               # 会话创建
jq '.paths["/session/{sessionID}/message"]' opencode-api-doc.json           # 消息(历史+发送)
jq '.paths["/permission/{requestID}/reply"]' opencode-api-doc.json          # 权限确认
jq '.paths["/question/{requestID}/reply"]' opencode-api-doc.json            # ask_user
jq '.components.schemas | keys' opencode-api-doc.json                       # 全部 schema(含 Event 类型)
```

> 若 `GET /doc` 需要鉴权(`authOnlyRouterLayer`),先按 fork 的认证方式带 token(如 `Authorization` 头)请求。

### 7.3 curl 补充验证(可选,确认实际运行时行为)

```bash
# 1) 创建会话,记录返回的 sessionID
curl -X POST http://localhost:PORT/session -H 'Content-Type: application/json' -d '{}'

# 2) 发送消息,观察流式返回格式
curl -X POST http://localhost:PORT/session/<id>/message \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"hello"}]}'

# 3) 获取消息历史,确认 Message/Part 表结构
curl http://localhost:PORT/session/<id>/message

# 4) 订阅 SSE,记录事件 type 与 properties 字段(重点:是否含 sessionID)
curl -N http://localhost:PORT/event
```

### 7.4 记录项

| 记录项 | 来源 | 决定后续 |
|---|---|---|
| SSE 事件 `type` 字符串全集 | `/doc` 的 `Event` schema + §7.3 实测 | §4.2 映射表设计 |
| `properties.sessionID` 是否存在 | §7.3 订阅 SSE 实测 | 事件路由是否需额外解析 |
| `GET /session/:id/message` 返回结构 | `/doc` schema + §7.3-3 | `forkMessageToTurn()` 转换器设计 |
| `POST /session/:id/message` 请求体约束 | `/doc` requestBody schema | `sendMessage` 对齐 |

---

## 8. 风险与注意事项

| 风险 | 影响 | 缓解 |
|---|---|---|
| fork 与 VS Code 协议各自演化,API 可能漂移 | 端点/字段不匹配 | 以 VS Code 侧 `IAgent` 为唯一契约,翻译逻辑全部放 VS Code 侧 |
| fork 事件 payload 缺少 `sessionID` | 事件无法路由到会话 | §4.5-3 在 fork 侧补齐,或 VS Code 侧按 `id` 关联 |
| fork 内部业务路由被误改 | 破坏 kilo 现有功能 | 严格只动 `httpapi` 组增量,不碰 `testagent`/worktree 路由 |
| 传输层(HTTP+SSE)脆弱,依赖端口解析 | 连接稳定性 | 远期可选改为 stdio JSON-RPC(见 §8.1,不在本期范围) |
| `changeModel` 依赖 fork 能力 | 可能无法运行时切换 | 若 fork 不支持,标记为不支持并向 UI 暴露能力开关 |

### 8.1 远期可选项(本期不做)

- 传输层改为 stdio JSON-RPC(参考 Codex `transportFromChildProcess`),摆脱端口探测;
- `chats.changeAgent` / 子 agent(`onDidSpawnChat`、`getSubagentSessions`)—— 依赖 fork 子会话能力成熟度。

---

## 9. 附录

### 9.1 相关文件索引

| 文件 | 用途 |
|---|---|
| `src/vs/platform/agentHost/node/openCode/openCodeAgent.ts` | provider 实现(协议缺口主要在 `chats.*` 与 `models`) |
| `src/vs/platform/agentHost/node/openCode/openCodeSession.ts` | 会话实现(历史/事件翻译/权限) |
| `src/vs/platform/agentHost/node/openCode/openCodeEventStream.ts` | SSE 客户端(结构已兼容,无需大改) |
| `src/vs/platform/agentHost/node/agentHostMain.ts` | provider 注册(openCode 注册逻辑,L270-273) |
| `src/vs/platform/agentHost/common/agentService.ts` | 协议定义 `IAgent` / `IAgentChats` / `AgentSignal` |
| testagent-core `packages/opencode/src/server/routes/instance/httpapi/` | fork HTTP API 端点 |
| testagent-core `packages/opencode/src/bus/` | fork 事件定义(BusEvent.define) |

### 9.2 fork 关键端点速查

| 能力 | 端点 |
|---|---|
| 会话 CRUD | `POST /session`、`DELETE /session/:id`、`PATCH /session/:id` |
| 发消息 | `POST /session/:id/message`、v2 `POST /api/session/:id/prompt` |
| 历史 | `GET /session/:id/message`、v2 `GET /api/session/:id/message` |
| fork | `POST /session/:id/fork` |
| abort | `POST /session/:id/abort` |
| 权限 | `GET /permission`、`POST /permission/:requestID/reply` |
| 用户输入 | `GET /question`、`POST /question/:requestID/reply`、`/reject` |
| 模型/供应商 | `GET /provider` |
| 事件流 | `GET /event`(SSE) |
| 子会话 | `GET /session/:id/children` |

### 9.3 协议信号类型速查(agent host 侧)

| 信号 | 用途 |
|---|---|
| `IAgentActionSignal`(`kind: 'action'`) | 协议动作直发(现有聊天路径已用) |
| `IAgentToolPendingConfirmationSignal`(`kind: 'pending_confirmation'`) | 工具权限确认(本期新增) |
| `IAgentSubagentStartedSignal` / `IAgentSubagentCompletedSignal` | 子 agent(远期) |
| `IAgentSteeringConsumedSignal` | steering 消息(远期) |

---

## 10. 附:Agents 窗口 ↔ 编辑器 TestAgent 插件 会话切换(跨窗口 handoff)

> 本节是 testagent agent-host provider 与编辑器侧 testagent 扩展插件之间的会话身份桥接,与 §1–§9 的 OpenCode HTTP 适配属不同层,但同属 agent host 生态,故附于此。

### 10.1 背景与现象

在 Agents 窗口(agent window)模式下新建 quick chat 后切到编辑器模式,编辑器能进入该 quick chat 的 scratch 目录 `.testagent/chats/{id}`;但从编辑器切回 Agents 窗口时,**不会自动回到刚才的会话**,而是落在一个新的/空白会话上。

### 10.2 根因分析(3 个叠加缺陷)

1. **client/host scheme 不匹配(致命)**:编辑器侧向 agent host 请求 `resolveBackendSessionId` 时,传入的是客户端资源 `agent-host-<provider>://<id>`;host 的 `AgentHostProviderService.getProviderForSession` 按 provider-native scheme `<provider>://<id>` 索引 provider,`agent-host-testagent` 查不到 → `resolveBackendSessionId` 返回 `undefined`,整条 handoff 静默失败。这是“目录能进、会话回不去”的直接原因,也是上一版修复不生效的原因。
2. **`isCreated` 门槛**:新建 quick chat 在发出第一条消息前状态为 `Untitled`(`NewSession` 的 `markNew`/`markSent`,`isCreated = status !== Untitled`)。此前 handoff 全部 gate 在 `session.isCreated.get()` 上,未发送草稿被完全跳过。
3. **无 workspace 时提前返回**:`openSessionInVSCode` 在 `!folderUris?.length` 时提前开空窗口,把已算出的 `testagentSession` 丢弃,导致未发送 quick chat 连会话 handoff 都没有。

此外,未发送 quick chat 的客户端 workspace 为空(`NewSession` 不消费 eagerCreate 的 `resolvedWorkingDirectory`),所以编辑器会开成空窗口、进不了目录(见 §10.8)。

### 10.3 协议改动(VS Code-only extension RPC,非生成 AHP 协议)

新增两个扩展方法(定义在 `src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts`),复用既有 `allowExtensionMethods` 通道,**不修改生成的 AHP 协议**:

| 方法常量 | `method` | params | result |
|---|---|---|---|
| `ResolveBackendSessionIdExtensionMethod` | `vscode/resolveBackendSessionId` | `{ session: string }` | `{ backendSessionId?: string }` |
| `ResolveSessionByBackendSessionIdExtensionMethod` | `vscode/resolveSessionByBackendSessionId` | `{ provider: string, backendSessionId: string }` | `{ session?: string }` |

可选能力挂在如下接口:`IAgent.resolveBackendSessionId?` / `IAgent.resolveSessionUriForBackendSessionId?`;`IAgentService` / `IAgentConnection` 同名可选方法;`testagent` provider 实现(通过 `_sessionMap` / `_getTestAgentId` 维护 Agent Host sessionId ↔ backend conversation id 映射)。

### 10.4 scheme 映射与数据流

```
Agents 窗口                                  编辑器(TestAgent 插件)
  active session S (agent-host-testagent:/<rawId>)
        │  Open in Editor
        ▼
  resolveBackendSessionId(S)  ──扩展RPC──▶ host provider(testagent)
        │  (客户端 scheme → host scheme 翻译)
        ▼
  backendSessionId B + agentHostResource S
        │  native: vscode:openTestAgentSession
        ▼
                                         testagent.new.openSession(B, dir, S)
                                           → 聚焦插件会话
        ┌──────────── 切回(Open in Agents) ────────────┐
        ▼                                              │
  testagent.new.getActiveSession → { sessionId:B, agentHostResource:S }
        │  getTestAgentSessionHandoff 优先用 agentHostResource
        ▼
  OpenChatSessionInAgentsWindowAction(sessionResource=S)
        ▼
  host openExistingSession(S) → 重新进入该会话
```

**scheme 约定(关键)**:

| 边界 | scheme 形式 | 示例 |
|---|---|---|
| 客户端(编辑器/窗口) | `${LOCAL_AGENT_HOST_SCHEME_PREFIX}${provider}` | `agent-host-testagent` |
| host / 协议线上 | provider-native `<provider>` | `testagent` |

跨边界必须翻译:客户端 → host 用 `session.scheme.substring(LOCAL_AGENT_HOST_SCHEME_PREFIX.length)`;host → 客户端用 `LOCAL_AGENT_HOST_SCHEME_PREFIX + provider` 重新拼装。

### 10.5 核心仓库改动清单

| 文件 | 改动 |
|---|---|
| `src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts` | 新增两个 extension method + validator + command map |
| `src/vs/platform/agentHost/common/agent.ts` | `IAgent` 可选方法 |
| `src/vs/platform/agentHost/common/agentService.ts` | `IAgentService` / `IAgentConnection` 可选方法 |
| `src/vs/platform/agentHost/browser/agentHostProtocolClient.ts` | 客户端实现;**客户端 scheme → host scheme 翻译修复** |
| `src/vs/platform/agentHost/browser/nullAgentHostService.ts` | null 实现 |
| `src/vs/platform/agentHost/electron-browser/localAgentHostService.ts` | 本地委托 |
| `src/vs/platform/agentHost/node/agentService.ts` | host 实现(经 providerService 路由) |
| `src/vs/platform/agentHost/node/protocolServerHandler.ts` | extension 请求 handler |
| `src/vs/platform/agentHost/node/testagent/testagentAgent.ts` | provider 实现(映射 / 回退) |
| `src/vs/platform/window/common/window.ts` | `IAgentsWindowTestAgentSession`;`IOpenWindowOptions.testagentSession`;`IOpenEmptyWindowOptions.testagentSession` |
| `src/vs/platform/native/electron-main/nativeHostMainService.ts` | `doOpenWindow` / `doOpenEmptyWindow` 发送 `vscode:openTestAgentSession`(含 reload waiter) |
| `src/vs/sessions/electron-browser/actions/vscodeActions.ts` | `getTestAgentSessionToOpenInEditor`(去掉 isCreated 门槛);无 folder 也 handoff |
| `src/vs/workbench/contrib/chat/electron-browser/agentSessions/agentSessionsActions.ts` | `getTestAgentSessionHandoff`;标题栏/命令/OpenChatSession 三个入口;await 前需同步取 `getReuseWindowOption(accessor)`(否则触发 `local/code-no-accessor-after-await`) |
| `src/vs/workbench/contrib/chat/electron-browser/chat.contribution.ts` | `vscode:openTestAgentSession` → 执行 `testagent.new.openSession` |

### 10.6 testagent-kilo(扩展仓库)改动清单

| 文件 | 改动 |
|---|---|
| `packages/kilo-vscode/package.json` | 注册命令 `testagent.new.openSession` / `testagent.new.getActiveSession` |
| `packages/kilo-vscode/src/extension.ts` | 两个命令实现(openSession 先 focus 侧栏) |
| `packages/kilo-vscode/src/KiloProvider.ts` | `openSession()` / `getActiveSessionHandoff()` / `flushPendingOpenSession()` / `handoffResources` |
| `packages/kilo-vscode/webview-ui/src/App.tsx` | 处理 `openSession` 消息(`tabs.open` / `selectSession`) |
| `packages/kilo-vscode/webview-ui/src/types/messages.ts` | `OpenSessionMessage` 类型 |

> 两仓库必须**成对上线**:核心仓库发 `vscode:openTestAgentSession`,扩展提供 `testagent.new.openSession`;反向核心查 `testagent.new.getActiveSession`。只改一边会命令找不到、handoff 静默失败。

### 10.7 验证方法(launch skill)

```bash
LAUNCH=.agents/skills/launch/scripts/launch.sh
"$LAUNCH" --agents --repo <repo> --source-user-data-dir ~/.tscode \
  --disable-workspace-trust --skip-prelaunch \
  -- --extensionDevelopmentPath=/Users/lujs/project/testagent-kilo/packages/kilo-vscode
```

实测通过的关键日志链:

```
resolveBackendSessionId -> "<backendId>"                 # 修复前为 undefined
testagentSession = { sessionId, agentHostResource }      # 修复后已计算
[editor] received openTestAgentSession                    # IPC 到达编辑器
[editor] openSession command result true                  # 插件命令执行成功
```

### 10.8 已知遗留问题

1. **未发送 quick chat 客户端无 workspace**:`NewSession` 不消费 eagerCreate 的 `resolvedWorkingDirectory`,只有 materialize 后的 adapter 才在 `_computeWorkspace` 投影 scratch 目录。因此切到编辑器会开空窗口、进不了 `.testagent/chats/{id}`。彻底修复需在 provider 侧于 eagerCreate 后把 scratch 目录投影为 `NewSession` 的 workspace。
2. **backend id 回退风险**:`testagent.resolveBackendSessionId` 在映射未就绪时回退为 Agent Host raw id,插件会报 `Server error: Session not found: <rawId>`。建议映射未就绪时不要回退为 raw id,或在 handoff 侧识别并重试。
3. 受限环境(无网络 / 鉴权网关不可达)下后端会话可能未 materialize,无法端到端验证“切回自动进入会话”的最后一段;需在有后端的开发机复验。

### 10.9 复用要点

- 任何跨“客户端窗口 ↔ agent host provider”的会话身份查询,都要先做 scheme 翻译(§10.4),否则 host provider 查找必失败。
- extension RPC 仅经 `allowExtensionMethods`,不影响生成的 AHP 协议;新能力优先用“可选方法 + 能力探测”的方式增量扩展。
- 相关历史尝试在分支 `backup/session-handoff-20261003`(core 与 kilo 各一支);本方案在其基础上补齐了 scheme 翻译、未发送草稿、无 folder 三个缺口。

---

*本文档基于 2026-08-17 的代码分析产出,协议与端点以实测为准(见 §7);§10 于 2026-10-03 补充,基于实际运行调试。*

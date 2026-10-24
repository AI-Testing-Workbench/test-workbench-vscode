# Trae Agent 窗口调研与 tscode+dsh 演进计划

- 状态：draft
- 日期：2026-10-24
- 关联文档：
  - `docs/dsh集成tscode计划.md` §14
  - `docs/dsh-agent/adr-0001-agent-window.md`
  - `docs/dsh-agent/adr-0002-node-runtime.md`
  - `docs/dsh-agent/changelog.md`
- 调研对象：`/Applications/Trae CN.app/Contents`（Trae CN 1.107.1）
- 调研方法：静态检查包结构、JS bundle、preload、模块清单、字符串；未运行应用，未反编译原生 dylib

## 0. 结论摘要

1. **Trae 的 Agent 模式不是“复用 VS Code 原生 UI”**。聊天、工具卡片、文件树、终端展示、diff/预览基本都是 Trae 自己的 React 实现。
2. **Trae 复用 VS Code 的是服务层**：文件、编辑器、终端、搜索、命令、主题、认证、设置等。这里的“复用”是复用服务能力，不是跨窗口共享同一个扩展宿主实例；Agent 窗口本身仍是 workbench 窗口，扩展宿主按窗口生命周期运行。
3. **用户感知上，Trae 的 IDE 和 Agent 也像两个应用**；它的“整合感”来自同一个 Electron app、同一个工作台体系、直接服务调用和同窗口模式切换，而不是组件复用。
4. **tscode 当前的“IDE 窗口 + dsh web Agent 窗口”与 Trae 在形态上接近**，不需要推翻现有架构。
5. **tscode 的下一步不是重写 Agent UI**，而是把 bridge 从点对点方法升级为能力层，优先接文件、搜索、diagnostics、终端、diff/apply 五类服务。
6. **不建议**为追 Trae 去 fork Electron/workbench、重写原生 Agent、或把 dsh 源码 merge 进 tscode。

## 1. 调研范围与方法

本次调研回答三个问题：

- Trae 的 Agent Solo Lite 窗口是怎么打开的、怎么渲染的？
- 它和 VS Code workbench 到底共享什么、不共享什么？
- tscode + dsh 应该借鉴什么、避免什么？

证据来源：

- `Resources/app/out/main.js`
- `Resources/app/out/vs/code/electron-browser/solo/{workbench.js,solo-lite.html}`
- `Resources/app/out/vs/workbench/workbench.desktop.main.solo-lite.js`
- `Resources/app/out/vs/base/parts/sandbox/electron-browser/preload.js`
- `Resources/app/node_modules/@byted-icube/{solo-lite,desktop-modules,ai-modules-chat}`
- `Resources/app/modules/{ai-agent,ckg,browser-bridge,sandbox}`
- `Resources/app/package.json`、`product.json`

限制：

- 未运行 Trae，未捕获实际 DOM、网络或进程；
- 未反编译 `libai_agent.dylib` / `libharness.dylib`；
- 原生协议、云端模型路由、工具审批细节未完整还原。

## 2. Trae Agent Solo Lite 窗口

### 2.1 窗口入口

IDE 右上角按钮：

```text
button.icube-open-solo-lite-window-button
label = "Agent"
arrow = "↗"
```

点击后执行：

```text
workbench.action.openSoloLiteWindow
```

命令行为：

- 先尝试 `_workbench.openRuntimeWindow(Agent)` 复用已有的 Agent runtime window；
- 没有则 `openWindow({ windowType: Agent })` 新开窗口；
- 带 URI 时使用 `forceReuseWindow: true`。

`windowType: Agent` 的 HTML 路由：

```text
Agent / Floating / TraeWork → vs/code/electron-browser/solo/solo-lite.html
IDE                         → vs/code/electron-browser/workbench/workbench.html
```

### 2.2 启动链

`solo-lite.html` 只包含：

- 全屏 `#root`；
- `@byted-icube/solo-lite/dist/index.css`；
- `solo/workbench.js`。

`solo/workbench.js`：

1. 读取窗口配置；
2. 设置 import map（React、ReactDOM、Katex、`desktop-modules`、`ai-modules-chat`、`mutative`）；
3. 动态导入 `@byted-icube/solo-lite`；
4. 动态导入 `@byted-icube/desktop-modules`；
5. 动态导入 `workbench.desktop.main.solo-lite.js` 或 `solo-lite-slim.js`。

`@byted-icube/solo-lite` 被导入时会自动挂载：

```text
#root
  └─ ThemeProvider
      └─ DesktopModulesProvider
          └─ Suspense
              └─ Lazy Solo App
```

### 2.3 技术形态

Trae 的 Agent 窗口是 **React UI + VS Code 服务层** 的混合体：

```text
BrowserWindow (Agent)
├─ #root
│   └─ @byted-icube/solo-lite React App
│       ├─ 聊天 / 任务 / 工具卡片
│       ├─ 文件树 / mention
│       ├─ 终端 mirror（xterm）
│       └─ diff / 预览
│
└─ workbench.desktop.main.solo-lite.js
    ├─ VS Code 服务层（扩展宿主按窗口运行）
    ├─ 命令、主题、设置、认证
    ├─ 编辑器、终端、搜索、语言服务
    └─ iCubeReactComponentRegistry
```

`iCubeReactComponentRegistry` 负责把 React 组件挂进 workbench：

- `dynamicCreateComponent(id)`
- `dynamicCreateElement(...)`
- 每个组件有 `bridge`、`instanceId`、`serviceCollection`
- React 通过 bridge 调 VS Code command/service
- 支持 `sendMessage` 宿主到组件通信

### 2.4 共享与不共享

| 能力 | Trae Agent 模式 | 是否共享 VS Code |
| --- | --- | --- |
| 聊天/消息/工具卡片 | `ai-modules-chat` React | 否 |
| 终端展示 | xterm TerminalMirror | UI 否；终端实例/数据来自 VS Code service |
| 文件树/mention | `ai-modules-chat` FileTree | UI 否；文件服务来自 VS Code |
| diff/预览 | React 组件 | UI 否；打开文件走 VS Code service |
| IDE app 标签 | `solo_ide_app` / workbench | 可能复用原生 editor/terminal |
| 主题/命令/扩展 | VS Code services | 是 |
| Agent 后端 | 原生 Rust `ai-agent` | 与 IDE 共享同一个 Agent 进程 |

关键结论：**共享的是服务层和 Agent 后端，不是可见 UI 组件。** 这里的“共享”指 Agent 窗口可以使用同一套 VS Code 服务能力；它不是和 IDE 窗口共享同一个服务实例或扩展宿主实例。

终端的具体做法：

- 通过 `IICubeCommonToolingTerminalService` / `terminalService` 取得 VS Code 终端实例；
- 使用 `getContentsAsSerialize()` 序列化终端 buffer；
- 在聊天卡片里用 xterm 自绘 “TerminalMirror”。

文件/编辑的具体做法：

- 文件树、mention picker 是 React 自绘；
- 打开文件、reveal、命令执行通过 VS Code 服务；
- Agent 编辑应走 workspace edit / editor service，而不是直接写盘。

### 2.5 后端与 IPC

- 原生 Agent：`libai_agent.dylib` 或 `libharness.dylib`
- 工具宿主：`libtoolhost.dylib` + `ctx-cli`
- 网络：`libsscronet` / `@aha-kit/net`
- 代码知识图谱：`libckg.dylib`
- 沙箱：`trae-sandbox` / `sandbox-launcher`
- 浏览器桥：`browser-bridge`（127.0.0.1:19234）

通信：

- preload 暴露 `vscode.ahaIpc`；
- AHA IPC 使用 ZeroMQ DEALER/ROUTER；
- renderer 可直接连原生 Agent；
- 原生 Agent 在应用启动时由主进程拉起，窗口只是复用/新开 renderer。

### 2.6 与 TraeWork 的区别

`TraeWork` 在当前包里有两种含义：

1. **窗口类型**：SOLO 产品的默认窗口类型，也走 `solo-lite.html`；
2. **旧版 Trae Work 应用**：`TraeWorkApplication`、`traeWorkMigrationSource` 等，用于数据迁移。

IDE 右上角的 “Agent ↗” 明确传的是 `Qu.Agent`，不是 `Qu.TraeWork`。不要把两者混为一谈。

## 3. tscode + dsh 现状

```text
Electron main
├─ IDE 窗口
│   └─ VS Code workbench
└─ Agent 窗口
    ├─ dsh web（独立 Web UI）
    └─ 主进程代理 + window.tscodeAgent bridge
        ├─ dsh Host（Node 24.18）
        └─ IDE 能力（openFile/reveal/diff/theme/context）
```

已有能力：

- 独立 Agent BrowserWindow；
- `dsh-agent://app/` 自定义协议；
- token/cookie 认证、HTTP/WS 代理；
- `window.tscodeAgent` 白名单 bridge；
- 主题/上下文/选区同步；
- `openFile` / `openDiff` / `revealInExplorer`；
- Host 生命周期、健康检查、崩溃重启；
- dsh profile 隔离与插件注入；
- dsh Node 24.18 运行时与 fork 构建计划。

## 4. 对比

| 维度 | tscode + dsh | Trae |
| --- | --- | --- |
| UI | dsh web（独立 UI） | Solo Lite React（自绘 UI） |
| 是否复用 VS Code 可见组件 | 否 | 否 |
| 是否复用 VS Code 服务层 | 部分，通过 bridge | 是，直接调用 |
| 窗口 | 独立 BrowserWindow | 独立 BrowserWindow |
| 主进程 | 同一个 Electron app | 同一个 Electron app |
| 模式切换 | IDE/Agent 两个窗口 | IDE/Solo 可同窗口切换 |
| UI 与 Agent 通信 | HTTP/WS + 主进程代理 | ZeroMQ AHA IPC 直连 |
| 工具执行 | dsh tools（Node） | 原生 toolhost |
| 沙箱 | dsh/Node 权限 | 原生 sandbox |
| 上下文 | dsh 文件/搜索 | 原生 CKG |
| Electron | Stock Electron | 自定义 `@aha-kit/electron` |
| 维护成本 | 中等 | 很高 |
| 上游兼容 | 高 | 低 |

## 5. 关键结论

1. **前端形态接近**：两者的 Agent 都是另一套 UI，用户都会感觉像“两个应用”。
2. **Trae 的优势是集成深度**：同一 Electron app、同一 workbench 体系、直接服务调用、同窗口模式切换、直连 Agent IPC。
3. **tscode 的优势是可维护性**：Stock Electron、dsh 上游、白名单 bridge、独立 UI 栈。
4. **差距不在组件复用**，而在服务接入深度、窗口/模式体验、数据面延迟和原生能力。
5. **tscode 不应重写 Agent UI**；应把 bridge 做成能力层，并逐步补齐服务。

### 5.1 方案选择

| 方案 | 内容 | 结论 |
| --- | --- | --- |
| A. dsh web + 独立窗口 + 能力 bridge | 保持现有架构，扩 bridge | **推荐，P0/P1 主线** |
| B. dsh web 嵌入 workbench | webview / auxiliary bar / 自定义 view | P2 评估，取决于 UX 数据 |
| C. React shell + workbench 服务 | 自研 Agent UI，复用服务层 | P2，高成本，需独立团队 |
| D. Fork Electron/workbench + 原生 Agent | 复制 Trae 实现 | **不建议** |

## 6. 演进计划

### P0（0–1 个月）：稳定架构与能力补齐

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| P0-1 dsh fork 制品管线 | fork CI 产出 tarball/runtime artifact；tscode 下载、校验、安装 | macOS arm64 staging + smoke + GUI；x64/Windows 待 CI |
| P0-2 bridge 能力层 v1 | `fs.read/readDir/stat/watch`、`search.text/file`、`diagnostics.get`、`terminal.serialize`、`diff.apply/reject`、`editor.getState` | 单测 + smoke + dsh 工具卡片可用 |
| P0-3 工具审批与安全 | 命令 allow/deny、文件写入范围、Workspace Trust、审计日志 | 审批/取消 E2E |
| P0-4 性能基线 | 冷启动、Host ready、首 token、bridge 延迟、内存 | 记录基线数据 |
| P0-5 真实工具调用 E2E | API Key 下 read/write/command/approval/cancel | macOS + Windows |

### P1（1–3 个月）：窗口体验与上下文

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| P1-1 窗口复用/快速聊天 | Agent 窗口复用、浮动窗口、从 IDE 快速唤起 | 用户可在 1 次操作内回到会话 |
| P1-2 打开/跳转体验 | openFile/openDiff/reveal 后 IDE 聚焦；支持“在 IDE 中继续” | IDE 自动聚焦到正确位置 |
| P1-3 事件流 | 文件变化、选区、终端输出、diagnostics 事件；分页/取消 | 大输出不阻塞、无轮询 |
| P1-4 上下文增强 | repo map、相关文件、诊断、终端历史 | Agent 回答质量有可量化提升 |
| P1-5 沙箱/限制 | 命令/文件/网络策略、审批预设 | 越权操作被阻止 |
| P1-6 x64/Windows 验证 | 原生依赖、pty、sharp、koffi、文件锁 | CI 矩阵通过 |

### P2（3–6 个月）：按产品需要评估

| 任务 | 内容 | 触发条件 |
| --- | --- | --- |
| P2-1 嵌入 dsh UI | webview / auxiliary bar / 自定义 view | 用户反馈“窗口割裂”严重 |
| P2-2 数据面优化 | MessagePort/专用 IPC，控制面仍走主进程 | 测量确认代理是瓶颈 |
| P2-3 CKG/代码索引 | dsh fork 可选索引服务 | 上下文质量成为瓶颈 |
| P2-4 React shell | 复用 dsh client 组件 + workbench 服务 | 产品明确要求 IDE 原生 Agent UI，且团队可长期维护 |

### 不做

- 为 `ahaProcess`/`ahaIpc` fork Electron；
- 用 Rust 重写 dsh Agent；
- 把 dsh 源码 merge 进 tscode；
- 直接把 dsh WS/token 暴露给 renderer；
- 在没有产品需求前做原生 toolhost/sandbox/CKG；
- 为了“像 Trae”重写一套 Agent UI。

## 7. 验收指标

复用主计划 §1.2 的指标，并补充：

| 指标 | 目标 |
| --- | --- |
| Agent 窗口复用率 | > 80% |
| bridge 小操作 P95 | < 50ms（本机） |
| 搜索 P95 | < 300ms（中型仓库） |
| 工具调用成功率 | > 99%（排除模型错误） |
| 崩溃恢复 | < 5s，无孤儿进程 |
| 冷启动 | P95 < 6s（现有目标） |
| 首 token | 以模型/网络为基线，代理不成为瓶颈 |
| 内存增量 | 以基线测量为准，不因 bridge 事件泄漏 |

## 8. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| dsh fork 漂移 | 上游同步困难 | 保持 fork 薄、pin commit、兼容测试 |
| bridge 膨胀 | 安全面/维护成本上升 | 能力白名单、schema、审计、按需开放 |
| 代理延迟 | 流式体验 | 先测量；必要时 MessagePort 数据面 |
| Windows 原生依赖 | 打包/运行失败 | CI 矩阵、pty/sharp/koffi/文件锁验证 |
| UI 重写冲动 | 工期/维护失控 | 以 dsh web 为主，P2 再评估 |
| 签名/公证 | 发布阻塞 | 新增 `.node`/Node 二进制纳入签名流程 |

## 9. 开放问题

1. 独立 Agent 窗口是否真的是 UX 问题？需要用户反馈/数据。
2. dsh 实际需要哪些 VS Code 服务？需要 instrument bridge 调用。
3. dsh client 组件能否在 workbench renderer 中复用？需要 POC。
4. Trae Agent 窗口是否运行独立扩展宿主？静态分析倾向“是”，需运行时确认。
5. CKG/代码索引的收益是否足以覆盖维护成本？
6. 同窗口 IDE/Agent 切换是否值得做？还是窗口复用 + 快速聊天即可？

## 10. 证据索引

| 证据 | 路径 |
| --- | --- |
| 窗口类型路由 | `Resources/app/out/main.js` |
| Solo Lite 启动 | `Resources/app/out/vs/code/electron-browser/solo/workbench.js` |
| Solo Lite HTML | `Resources/app/out/vs/code/electron-browser/solo/solo-lite.html` |
| Solo workbench | `Resources/app/out/vs/workbench/workbench.desktop.main.solo-lite.js` |
| React 应用 | `Resources/app/node_modules/@byted-icube/solo-lite/dist/index.mjs` |
| 桌面桥 | `Resources/app/node_modules/@byted-icube/desktop-modules/dist/index.mjs` |
| 聊天/终端 mirror | `Resources/app/node_modules/@byted-icube/ai-modules-chat/dist/index.mjs` |
| preload AHA IPC | `Resources/app/out/vs/base/parts/sandbox/electron-browser/preload.js` |
| 原生 Agent | `Resources/app/modules/ai-agent` |
| 原生工具宿主 | `Resources/app/modules/ai-agent/lib*`、`bin/*` |
| CKG | `Resources/app/modules/ckg` |
| 沙箱 | `Resources/app/modules/sandbox` |
| 浏览器桥 | `Resources/app/modules/browser-bridge` |

## 11. 变更记录

- 2026-10-24：创建本文档，记录 Trae Agent Solo Lite 调研、tscode+dsh 对比与演进计划。
- 2026-10-24：修正上一轮“Trae 复用 VS Code 可见组件”的表述；实际是共享
  VS Code 服务层，不共享终端/文件树/编辑器等可见 UI 组件。
- 本次只新增/更新文档，未修改运行时代码或 runtime pin。

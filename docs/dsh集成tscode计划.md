# dsh Agent 窗口生产实施计划

> **范围**：在 tscode（VS Code fork）中新增一个独立的 dsh Agent 窗口，完整复用 dsh 前端与插件体系，类似 Trae 的 Agent 模式。不采用 VS Code 原生 Agent Host Chat UI。

## 目录

- [0. 计划前提](#0-计划前提)
- [1. 目标与成功标准](#1-目标与成功标准)
- [2. 工作分解（WBS）](#2-工作分解wbs)
- [3. 里程碑与时间表](#3-里程碑与时间表)
- [4. 各阶段交付物](#4-各阶段交付物)
- [5. 测试计划](#5-测试计划)
- [6. 安全与合规](#6-安全与合规)
- [7. 打包、发布与运维](#7-打包发布与运维)
- [8. 风险登记册](#8-风险登记册)
- [9. 团队与投入](#9-团队与投入)
- [10. 待决策事项](#10-待决策事项)
- [11. 生产就绪检查清单](#11-生产就绪检查清单)
- [12. 最终建议](#12-最终建议)
- [13. 实施记录（2026-10-24）](#13-实施记录2026-10-24)
- [14. 技术复盘：Electron 43 与 Host Node 运行时（2026-10-24）](#14-技术复盘electron-43-与-host-node-运行时2026-10-24)
- [15. dsh fork 与 tscode 集成构建（2026-10-25）](#15-dsh-fork-与-tscode-集成构建2026-10-25)

---

## 0. 计划前提

### 0.1 已确定的架构方向

```text
tscode Electron App
├─ IDE 窗口（现有 workbench）
├─ dsh Agent 窗口（新增 BrowserWindow）
│   ├─ 加载 dsh Web 前端（原样复用）
│   ├─ 独立 session partition
│   └─ preload：boot 注入 + tscode 桥接
├─ dsh Host 子进程（独立 Node 24.18.0）
│   ├─ dsh-desktop-host / dsh web
│   ├─ DSH_HOME=~/.tscode-dsh
│   └─ 独立 profile + 插件
└─ 自定义协议 dsh-agent:// + HTTP/WebSocket 代理
```

### 0.2 关键技术决策

| 决策 | 选择 | 原因 |
| --- | --- | --- |
| 窗口形态 | 同一 Electron 应用内的独立 BrowserWindow | 最接近 Trae Agent 模式，单应用体验 |
| dsh 前端 | 原样使用 dsh-web-frontend | 保留全部 dsh UI 与插件 |
| Host 运行时 | 独立 Node 24.18.0 | 规避 Electron 43.7.3 的 Electron/V8 指纹不兼容；不是单纯的 Node 版本问题，详见 §14 |
| Host 启动器 | dsh-desktop-host（生产）/ dsh web（开发） | desktop-host 提供 ready/injections/profile |
| 通信 | 自定义协议 + HTTP/WebSocket 代理 | 避免 token 暴露，控制认证与 CSP |
| IDE 集成 | dsh 客户端插件 + preload 白名单 API | 保持「一切皆插件」 |
| 数据目录 | `~/.tscode-dsh` | 与 dsh Desktop 的 `~/.dsh` 隔离 |

### 0.3 不在 v1 范围

- 远程 / SSH / 多根工作区
- dsh Work / Design 模式（先做 Code 模式）
- 与 VS Code 原生 Chat / Agent Host 的 UI 融合
- 迁移 dsh Desktop 的历史会话
- Linux 正式支持（v1 先 macOS / Windows，Linux beta）

> 2026-10-25 产品决策：完整保留 dsh 原生插件扩展能力（插件管理 UI、
> inventory、market、第三方插件安装、`hmr` 热重载）。原“插件市场 / 第三方
> 插件自由安装不在 v1 范围”的限制取消。安全控制改为 dsh 原生审批 + 安装来源
> 校验，详见 §6.3。

---

## 1. 目标与成功标准

### 1.1 产品目标

1. 用户在 IDE 内一键打开 dsh Agent 窗口。
2. dsh 前端、插件、工具链完整可用。
3. Agent 窗口与 IDE 共享工作区、主题、语言、选区。
4. 单应用、单安装包、单更新通道。
5. 安全边界清晰，不因 Agent 能力破坏 IDE 信任模型。

### 1.2 可量化指标

| 指标 | 目标 |
| --- | --- |
| Agent 窗口冷启动 P95 | < 6s（Host ready） |
| 窗口打开 P95 | < 2s（Host 已 ready） |
| 进程退出后孤儿进程 | 0 |
| Crash-free sessions | > 99.5% |
| Agent 会话任务成功率 | > 95% |
| Host 空闲 RSS | < 400MB |
| 典型会话 Host RSS | < 800MB |
| Beta 用户 Agent 窗口激活率 | > 25% |
| P0/P1 缺陷 | GA 前 0 |

---

## 2. 工作分解（WBS）

### Epic A：dsh Host 运行时

| 任务 | 产出 | 预估 |
| --- | --- | --- |
| A1 固定 dsh 版本与构建 | 可复现的 dsh runtime tarball | 3d |
| A2 独立 Node 24.18.0 runtime 打包 | 每平台 Node runtime | 2d |
| A3 DSH_HOME 与 profile 初始化 | `~/.tscode-dsh` + 默认 profile | 3d |
| A4 Host 启动器封装 | spawn、ready、fatal、shutdown | 5d |
| A5 进程监督与重启 | 重试、退避、安全模式 | 4d |
| A6 原生依赖验证 | koffi / node-pty / sharp / flock | 3d |
| A7 日志与诊断 | host stderr、版本、profile hash | 2d |

### Epic B：Agent 窗口与协议

| 任务 | 产出 | 预估 |
| --- | --- | --- |
| B1 新窗口类型 | DshAgentWindow 生命周期 | 4d |
| B2 自定义协议 `dsh-agent://` | 静态资源 + 代理 | 5d |
| B3 Host 认证 | token → cookie 交换 | 3d |
| B4 HTTP 代理 | `/api`、`/plugins`、`/connect` | 4d |
| B5 WebSocket 代理 | header 注入、重连 | 4d |
| B6 Boot 注入 | `__DSH_BOOT__` / `__DSH_TRANSPORT__` | 3d |
| B7 窗口行为 | 单实例、focus/reuse、close→hide | 3d |
| B8 主题 / 语言同步 | light/dark、zh/en | 3d |

### Epic C：IDE 桥接与 dsh 插件

| 任务 | 产出 | 预估 |
| --- | --- | --- |
| C1 preload 白名单 API | `window.tscodeAgent` | 3d |
| C2 IPC 安全校验 | sender/frame 校验 | 2d |
| C3 dsh-client-tscode 插件 | dsh 客户端插件包 | 5d |
| C4 打开文件 / Diff | IDE 联动 | 4d |
| C5 选区 / 工作区上下文 | 发送到 Agent | 3d |
| C6 从 IDE 打开 Agent | 命令、菜单、快捷键 | 2d |
| C7 错误与降级 | 无桥接时独立运行 | 2d |

### Epic D：安全与信任

| 任务 | 产出 | 预估 |
| --- | --- | --- |
| D1 窗口安全基线 | sandbox / contextIsolation / CSP | 2d |
| D2 导航与权限限制 | 禁止任意导航、外链 | 2d |
| D3 Workspace Trust | 未信任不启动 Host | 2d |
| D4 dsh profile 收敛 | 禁用市场/高风险插件 | 3d |
| D5 密钥管理 | SecretStorage / Keychain | 3d |
| D6 安全评审 | 威胁模型、渗透测试 | 5d |

### Epic E：打包、签名与更新

| 任务 | 产出 | 预估 |
| --- | --- | --- |
| E1 资源目录 | `resources/dsh-agent/` | 2d |
| E2 asar / unpack | 原生模块与动态插件 | 3d |
| E3 macOS 签名 / 公证 | notarization | 3d |
| E4 Windows 签名 | code signing | 3d |
| E5 安装包集成 | dmg / nsis / msi | 4d |
| E6 更新与回滚 | 随 app 更新、保留旧 runtime | 4d |
| E7 第三方 notices | 许可证合规 | 2d |
| E8 体积优化 | 按平台裁剪 | 3d |

### Epic F：测试与质量

| 任务 | 产出 | 预估 |
| --- | --- | --- |
| F1 单元测试 | 协议、代理、桥接、校验 | 5d |
| F2 集成测试 | Host 生命周期、认证、WS | 5d |
| F3 E2E | 开窗、会话、工具、权限、取消 | 8d |
| F4 兼容性矩阵 | macOS arm64/x64、Win x64 | 5d |
| F5 性能 / soak | 启动、内存、8h 会话 | 4d |
| F6 安全测试 | IPC fuzz、导航、插件 | 4d |
| F7 可访问性 / i18n | 键盘、读屏、高对比 | 3d |

### Epic G：发布与运维

| 任务 | 产出 | 预估 |
| --- | --- | --- |
| G1 Feature flag | 本地/远程开关 | 2d |
| G2 遥测 | 启动、崩溃、错误码 | 3d |
| G3 崩溃报告 | Host 诊断包 | 3d |
| G4 支持文档 | 用户/排障/管理员 | 3d |
| G5 Beta 运营 | 反馈、指标、修复 | 10d |
| G6 GA 发布 | 分阶段放量 | 5d |

---

## 3. 里程碑与时间表

按 **4 名工程师 + 1 名 QA** 估算，约 **20 周**（含 2–3 周缓冲）。

### 3.1 阶段划分

| 阶段 | 周 | 里程碑 | 退出标准 |
| --- | --- | --- | --- |
| Phase 0 | W0–W2 | POC | dsh UI 在 tscode 窗口完整加载；插件、会话、工具可用 |
| Phase 1 | W3–W6 | Core Shell | 自定义协议、Host 生命周期、认证、WS、窗口行为稳定 |
| Phase 2 | W7–W10 | IDE Integration | 桥接插件、工作区/选区/打开文件、安全基线通过 |
| Phase 3 | W11–W13 | Release Engineering | macOS/Windows 签名安装包、更新/回滚验证 |
| Phase 4 | W14–W17 | Beta / Hardening | Beta 指标达标，P0/P1 清零 |
| GA | W18–W19 | GA | 分阶段放量，回滚预案就绪 |
| Buffer | W20 | 缓冲 | 处理未预见问题 |

### 3.2 决策门（Gate）

| Gate | 时间 | 必须通过 |
| --- | --- | --- |
| G0 | W2 | POC 演示；独立 Node Host 可用；无阻断性问题 |
| G1 | W6 | 窗口稳定；无孤儿进程；认证/WS 重连通过 |
| G2 | W10 | 安全评审通过；Workspace Trust 生效 |
| G3 | W13 | 签名安装包；更新/回滚演练通过 |
| G4 | W17 | Beta crash-free > 99.5%；无 P0/P1 |
| G5 | W19 | GA 放量审批 |

---

## 4. 各阶段交付物

### Phase 0：POC（2 周）

**交付**

- dsh web 在 tscode BrowserWindow 中加载
- 独立 Node Host 启动脚本
- dsh 插件加载验证
- 会话 / 工具调用验证
- 架构决策记录（ADR）

**退出标准**

- dsh 前端完整渲染
- 至少一个 dsh 客户端插件正常加载
- 至少一次文件编辑 + 命令执行成功
- 无 Electron ABI / 指纹阻断

### Phase 1：Core Shell（4 周）

**交付**

- `dsh-agent://` 协议
- Host 子进程管理
- token → cookie 认证
- HTTP / WebSocket 代理
- Boot 注入
- 窗口单实例、focus/reuse、close→hide
- 主题 / 语言同步

**退出标准**

- 冷启动 P95 < 6s
- 连续开关窗口 100 次无泄漏
- 断网/重连后 WebSocket 恢复
- 退出应用后无孤儿进程

### Phase 2：IDE Integration（4 周）

**交付**

- `window.tscodeAgent` preload API
- dsh-client-tscode 插件
- 当前工作区 / 选区注入
- 在 IDE 打开文件 / Diff
- Workspace Trust
- dsh profile 收敛
- 安全评审

**退出标准**

- IDE → Agent、Agent → IDE 双向联动
- 未信任工作区不启动 Host
- 桥接 API 无越权
- 安全评审无高危项

### Phase 3：Release Engineering（3 周）

**交付**

- `resources/dsh-agent/{node,app,web,host}`
- macOS 签名 + 公证
- Windows 签名
- 安装包 / 更新 / 回滚
- 第三方 notices
- 体积报告

**退出标准**

- 干净机器安装成功
- 升级保留会话与配置
- 回滚到旧版本成功
- 许可证合规通过

### Phase 4：Beta / Hardening（4 周）

**交付**

- Beta 版本 + Feature flag
- 遥测看板
- 崩溃报告
- 性能 / soak 报告
- 用户 / 管理员文档
- 支持 runbook

**退出标准**

- Beta 指标达标
- P0/P1 清零
- 回滚演练通过
- 支持团队可独立排障

---

## 5. 测试计划

### 5.1 单元测试

- 协议路由：`dsh-agent://` 静态/代理/404
- Cookie 交换与 header 过滤
- WebSocket origin/cookie 注入
- preload IPC 参数校验
- 桥接 API 白名单
- Boot 注入顺序

### 5.2 集成测试

- Host 启动 → ready → window load
- Host fatal → 窗口错误态 → 重启
- 窗口关闭 → Host 保留/停止
- 应用退出 → 无孤儿进程
- 认证失败 → 友好错误
- WebSocket 断开 → 重连

### 5.3 E2E

- 打开 Agent 窗口
- 创建会话、发送消息、流式输出
- 工具调用（读/写/命令）
- 权限请求 / 拒绝
- 取消任务
- 关闭重开、恢复会话
- 崩溃后恢复
- IDE 打开文件 / Diff
- 主题切换

### 5.4 安全测试

- 未信任工作区
- 恶意页面导航
- IPC fuzz
- preload API 越权
- dsh 插件权限
- 密钥不落盘 / 不写日志

### 5.5 性能 / soak

- 冷启动 / 热启动
- 8 小时会话内存
- 大仓库索引
- 100 次开关窗口
- 多会话并发

### 5.6 兼容性

- macOS arm64 / x64
- Windows x64
- Linux x64（beta）
- HiDPI
- 代理 / 企业 TLS
- 离线

---

## 6. 安全与合规

### 6.1 窗口安全

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- 独立 session partition
- 严格 CSP
- 禁止 `window.open` / 任意导航
- 外链交给系统浏览器
- 只允许 `dsh-agent://app` 源

### 6.2 桥接安全

- preload 只暴露白名单 API
- IPC 校验 sender / frame / URL
- 不暴露 Node、fs、shell
- 参数类型与路径校验
- 限流与超时

### 6.3 dsh 权限收敛

2026-10-25 产品决策：**完整保留 dsh 原生插件扩展能力**。插件管理 UI、设置页、
inventory、官方插件 inventory、market 和 `hmr` 热重载均启用；
`plugin-manager` 与 `tool-plugin-manager` 也必须保留（dsh 0.2.1 的内置 agent
preset 会挂载 `@deepseek-ai/dsh-plugin-manager/tools`，禁用 `pluginManager`
服务会导致所有新会话创建失败：`agent-preset/invalid: ... waiting for
pluginManager`）。

因此 tscode 不再通过 managed profile patch 禁用任何 dsh 插件；配置文件中的
managed block 会被移除，没有用户自定义行时保留为合法的 `[]`。

未由 web profile 挂载的 `computer_use`、`browser_use` 和任意远程 MCP 保持不
启用。第三方插件运行在 workspace sandbox 之外，安装来源与信任由用户负责；
agent 侧 `plugin_manager` 工具每次调用都要求显式的 `danger-full-access`
审批，且不会因为 workspace-write 自动放行。

权限走 VS Code / dsh 的审批 UI，两者只保留一套为准。

### 6.4 数据与隐私

- `DSH_HOME=~/.tscode-dsh`
- 密钥存 OS Keychain / VS Code SecretStorage
- 遥测不含 prompt、代码、文件内容
- 日志脱敏
- 卸载时可选清理

### 6.5 合规

- dsh MIT + 第三方 notices
- Node / Chromium / native 依赖许可证
- LibreOffice / Sharp 等特殊依赖单独审计
- 安装包内 `ThirdPartyNotices.txt`

---

## 7. 打包、发布与运维

### 7.1 目录结构

```text
resources/dsh-agent/
  node/                 # Node 24.18.0
  app/                  # dsh runtime + profile
  web/                  # dsh-web-frontend dist
  host/                 # dsh-desktop-host
  VERSION
  THIRD_PARTY_NOTICES
```

> 2026-10-25 起，`app/` 的 dsh runtime 来源改为 `testagent-dsh` 打包的
> artifact，不再从公共 npm 安装；详见 §15。

### 7.2 更新策略

- dsh 随 tscode 应用更新，不做独立更新器
- dsh runtime 由 fork artifact 提供；tscode 发布时拉取并随安装包一起更新
- 保留上一版 runtime 目录，支持回滚
- 更新前检查运行中任务
- 更新后首次启动做 profile 迁移

### 7.3 日志与诊断

```text
~/.tscode/logs/dsh-agent/
  host.log
  proxy.log
  crash-*.json
```

> 当前实现：Host stderr 写入 tscode main log 的 `[dshAgent:host]`，崩溃报告写入
> `<userData>/logs/dsh-agent/crash-*.json`；独立的 `host.log` / `proxy.log` 仍是
> 后续可选的拆分目标，`docs/dsh-agent/operations.md` 按实际实现描述。

崩溃报告包含：

- dsh / Node / Electron 版本
- Host 退出码
- stderr 尾部
- profile hash
- 最近窗口 / 协议错误
- 不含 prompt / 文件内容

### 7.4 重启策略

| 场景 | 处理 |
| --- | --- |
| Host 异常退出 | 最多 3 次指数退避重启 |
| 连续失败 | 进入安全模式（禁用插件） |
| 安全模式仍失败 | 提示用户打开日志/反馈 |

### 7.5 Feature flag 与放量

- `dsh.agentWindow.enabled`
- 内部 dogfood：默认 `true`
- Beta：10% → 25% → 50%
- GA：100%
- 远程 kill switch：关闭入口，保留数据

---

## 8. 风险登记册

| 风险 | 等级 | 影响 | 缓解 |
| --- | --- | --- | --- |
| dsh 预发布 API 变动 | 高 | 前端/Host 不兼容 | 固定版本、vendor、契约测试、升级窗口 |
| Electron/V8 指纹不兼容 | 高 | 无法共享 Electron 内置 Node | 独立 Node sidecar；`node-addon-require-builtin` 按精确 Electron/V8 构建匹配，见 §14 |
| 原生依赖平台差异 | 高 | Host 启动失败 | 每平台 CI + 冒烟测试 |
| WebSocket/认证问题 | 中高 | 会话断连 | 集成测试 + 重连 + 诊断 |
| Host 崩溃 | 中高 | Agent 不可用 | 监督、重启、安全模式 |
| 桥接越权 | 高 | 安全事件 | 白名单、IPC 校验、安全评审 |
| 打包体积 | 中 | 安装包变大 | 按平台裁剪、压缩、延迟资源 |
| 窗口生命周期 | 中 | 孤儿进程/数据丢失 | 单实例、quit 协调、soak |
| Upstream 同步冲突 | 中 | 维护成本 | 新文件隔离 + `test-workbench_change` |
| 许可证合规 | 中 | 发布阻断 | 早期审计 + notices |
| 账号/密钥模型 | 中 | 用户体验 | 明确 dsh 账号 vs tscode 账号 |
| 性能 | 中 | 卡顿 | 启动预算、内存看板、soak |

---

## 9. 团队与投入

| 角色 | 人数 | 主要职责 |
| --- | --- | --- |
| Tech Lead / Architect | 1 | 架构、ADR、Gate 评审 |
| Electron / VS Code Engineer | 2 | 窗口、协议、Host、打包 |
| dsh / Frontend Engineer | 1 | dsh 插件、桥接、UI 联动 |
| QA / Automation | 1 | 测试矩阵、E2E、Beta 支持 |
| Security | 0.3 | 威胁模型、评审 |
| Release / Build | 0.5 | 签名、公证、更新 |
| Design / Docs | 0.3 | 交互、文档 |

总投入约 **50–60 人周**。

---

## 10. 待决策事项

1. 单应用 vs 两个应用：建议单应用。
2. v1 平台：macOS + Windows；Linux beta。
3. dsh profile：standard vs minimal；v1 建议收敛版。
4. 插件市场：v1 关闭，只允许内置/审核插件。
5. 账号体系：dsh 账号独立，还是接 tscode 账号。
6. 数据目录命名与迁移策略。
7. 遥测是否默认开启（建议 opt-in）。
8. Feature flag 默认值与放量节奏。
9. v1 是否包含「从 IDE 发送选区到 Agent」（建议包含）。
10. 是否保留 dsh web 作为开发/排障模式（建议保留）。

---

## 11. 生产就绪检查清单

- [x] POC / Gate 0 通过（dsh UI 渲染、插件加载、桥接已验证；模型工具调用待密钥后复验）
- [x] 架构 ADR 签字（`docs/dsh-agent/adr-0001-agent-window.md`）
- [ ] 独立 Node Host 在所有目标平台启动成功（macOS arm64 已验证；x64/Windows 待 CI）
- [x] dsh 前端与插件完整加载（含 `dsh-client-tscode`，见 `e2e-smoke.mjs`）
- [x] 自定义协议 / 认证 / WS 稳定（HTTP 代理与 WS 握手已验证）
- [x] 无孤儿进程（正常退出、Cmd+Q、SIGTERM 均验证）
- [x] Workspace Trust 生效（策略与单元测试；UI 未信任流程待人工复验）
- [x] preload 白名单与 IPC 校验通过（单元测试 + 手动越权请求）
- [ ] 安全评审无高危（待 D6）
- [ ] 签名 / 公证 / 安装包通过（待证书与 CI）
- [ ] 更新 / 回滚演练通过（脚本已备，待安装包）
- [x] 第三方 notices 完整（`prepare-runtime.mjs` 生成，发布前需复核）
- [x] 遥测 / 崩溃报告可用
- [ ] Beta 指标达标（待真实用户）
- [x] 用户 / 管理员 / 排障文档完成（`docs/dsh-agent/`）
- [x] Feature flag / kill switch 可用
- [x] Node runtime 版本单源化（`.nvmrc` 与 `runtime.json` 均为 24.18.0；`prepare-runtime` 校验一致性）
- [ ] 支持团队完成培训
- [ ] GA 放量计划批准

---

## 12. 最终建议

1. 先做 **2 周 POC**，验证 dsh UI + 插件 + 独立 Node Host，再投入生产。
2. v1 只做 **Code 模式 + 本地单根工作区**，不要一开始全覆盖。
3. Host 用**独立 Node**，不要把 Electron 指纹兼容性变成长期维护负担。
4. dsh 前端不改，tscode 集成做成 **dsh 客户端插件**。
5. 所有 fork 改动隔离，新增文件优先，注册点打 `test-workbench_change`。
6. Beta 至少 **4 周**，用真实会话压崩溃、内存、权限和更新。
7. 保留 **kill switch 和回滚**，Agent 窗口是高风险能力，必须可降级。


---

## 13. 实施记录（2026-10-24）

### 13.1 已落地

代码全部隔离在新增目录，并在共享注册点打 `test-workbench_change`：

| 计划项 | 实现位置 |
| --- | --- |
| A1–A4、A7 | `src/vs/platform/dshAgent/node/dshAgentHost.ts`、`dshAgentPaths.ts`、`dshAgentProfile.ts`、`dshAgentDiagnostics.ts` |
| A5 | 退避重启（500ms→8s，最多 3 次）、安全模式（`~/.tscode-dsh-safe`）、`killSync` 退出保护 |
| A6 | 依赖清单与平台说明见 `resources/dsh-agent/README.md`；原生依赖实际调用待带密钥 E2E |
| B1–B8 | `electron-main/dshAgentWindow.ts`、`dshAgentMainService.ts`、`dshAgentProtocol.ts`、`node/dshAgentProxy.ts`、`electron-browser/dshAgentPreload.ts` |
| C1–C7 | preload 白名单、IPC 校验、`resources/dsh-agent/plugin/dsh-client-tscode`、IDE 命令/快捷键/菜单、上下文与失败降级 |
| D1–D5 | sandbox/contextIsolation/CSP、导航与权限限制、Workspace Trust 策略、profile 收敛、敏感信息脱敏 |
| E1–E8 | `scripts/dsh-agent/prepare-runtime.mjs`、`size-report.mjs`、`install-plugin.mjs`、`rollback-runtime.mjs`、`resources/dsh-agent/**`；`release.yml` / `release-darwin-x64.yml` 已加入运行时缓存、安装、冒烟、打包后校验。2026-10-25 起 runtime 改为从 `testagent-dsh` 的 artifact 拉取，见 §15 |
| F1–F2 | `src/vs/platform/dshAgent/test/**`、`scripts/dsh-agent/e2e-smoke.mjs` |
| G1–G4 | `dsh.agentWindow.*`、`dshAgent` product flags、遥测事件、崩溃报告、`docs/dsh-agent/**` |

### 13.2 关键设计偏差

- **WebSocket 未做字节级代理**：沿用 dsh Desktop 的做法，页面通过
  `__DSH_TRANSPORT__.streamBaseUrl` 直连 loopback Host，由
  `session.webRequest.onBeforeSendHeaders` 校验目标、改写 `Origin` 并注入
  cookie。效果等价且避免自定义协议上的 WS 升级；计划中的“WS 代理”按此实现。
- **未使用 `dsh-desktop-host`**：上游为 private 包，v1 使用公开 `dsh web`
  的 index（已含 `__DSH_BOOT__`）。迁移路径记录在
  `resources/dsh-agent/host/README.md`。
- **CSP 需要 `'unsafe-eval'`**：dsh 客户端在 boot 阶段使用运行时表达式求值；
  这是上游约束，已在 `docs/dsh-agent/security.md` 记录为受控例外。

### 13.3 验证结果

已在 macOS arm64 + Electron 43.7.3 + Node 22.22.1 + dsh 0.2.0-rc.2 上执行（初版记录；当前 pin 已升级到 Node 24.18.0，复验见 §14.2）：

```bash
npx tsgo --project ./src/tsconfig.json --noEmit --skipLibCheck   # 0 errors
npm run compile                                                  # 0 errors
npx mocha test/unit/node/index.js --delay --ui=tdd --timeout=15000 --exit
                                                                 # 8915 passing, 0 failing
node scripts/dsh-agent/e2e-smoke.mjs                             # PASS
```

`e2e-smoke.mjs` 覆盖：真实 `dsh web` 启动、303+cookie 交换、index 含
`__DSH_BOOT__`、插件 bundle 200/no-store、WS mux 握手、路径穿越 400、
隔离 profile 与插件自动安装。

GUI 手动验证（CDP）：

1. `dsh Agent: Open dsh Agent Window` 打开独立窗口，dsh UI 完整渲染。
2. 上下文桥返回工作区、活动文件、选区、语言、主题、语言环境、信任状态。
3. `openFile` / `openDiff` / `revealInExplorer` 在 IDE 正确打开或定位。
4. 工作区选择器通过 `__DSH_DIRECTORY_PICKER__` 返回 IDE 根目录。
5. IDE 切换 Light/Dark，Agent 的 `prefers-color-scheme` 同步变化。
6. 关闭窗口后 Host 存活、重开复用窗口；Cmd+Q 与 SIGTERM 后无孤儿进程。

### 13.4 未完成（需外部条件）

- F3 完整 E2E 的模型工具调用/权限审批/取消需要可用 API Key。
- F4 兼容性矩阵（macOS x64、Windows x64）需要 CI 机器。
- F6 安全渗透与 IPC fuzz、D6 安全评审需要独立安全团队。
- E3/E4/E5 签名、公证、安装包与 G5/G6 Beta/GA 需要证书、发布管线与用户数据；
  已接入构建，但 macOS 必须在签名时 deep-sign 打包内的 `node` 与原生模块，
  Windows 需确认 `node.exe`/`.node` 的签名策略。
- A6 原生依赖（koffi/node-pty/sharp/flock）已在 macOS arm64 下用 Node 22.22.1 与 staged Node 24.18.0 完成直接加载/调用验证，并通过 staged runtime 的 smoke/GUI；Windows/x64 和真实工具会话仍待 E2E。

---

## 14. 技术复盘：Electron 43 与 Host Node 运行时（2026-10-24）

### 14.1 结论

- **保留独立 Node sidecar，不改为 Electron 内置 Node。** 当前 Electron 43.7.3
  仍无法运行 dsh，原因不是 Node 版本，而是 `node-addon-require-builtin@0.1.9`
  对 Electron/V8 构建做精确指纹匹配。
- **已将 Host Node 从 22.22.1 升级到 24.18.0。** `.nvmrc`、`runtime.json` 和
  `prepare-runtime.mjs` 的校验已对齐，发布 CI 中因版本漂移导致的 staging 失败
  已消除。
- 完整决策与替代方案见 `docs/dsh-agent/adr-0002-node-runtime.md`；Trae Agent
  窗口对比与演进计划见
  `docs/dsh-agent/trae-agent-window-research-and-plan.md`；变更记录见
  `docs/dsh-agent/changelog.md`。

### 14.2 实测证据

dsh 启动链路：`dsh-app-boot` → `requireBuiltin("internal/modules/esm/loader")`
→ `node-addon-require-builtin`。该原生模块按 V8 内部布局做指纹校验，因此只支持
精确的 Electron/V8 构建。

当前 Electron 43.7.3：

```text
Node 24.21.0
V8 15.0.245.31-electron.0
NODE_MODULE_VERSION 148
```

用 `ELECTRON_RUN_AS_NODE=1` 启动 `dsh web` 的结果：

```text
unsupported Electron runtime fingerprint:
Node 24.21.0, V8 15.0.245.31-electron.0
(supported Electron versions: 43.0.0, 44.0.0, 44.7.0, 45.0.0-alpha.6)
```

注意支持表里是 `43.0.0`，当前是 `43.7.3`；V8 patch 不同即不匹配。**因此
“Electron 已经 43+”本身不能解除限制。**

2026-10-24 复验结果：

| 项目 | 结果 |
| --- | --- |
| `npm run compile-client` | 0 errors |
| dshAgent 单元测试 | 32 passing |
| `e2e-smoke.mjs`（Host Node 22.22.1） | PASS；Host ready 868ms |
| `e2e-smoke.mjs`（Host Node 24.18.0） | PASS；Host ready 578ms |
| GUI（Electron 43.7.3 + Node 22.22.1） | 窗口渲染、桥接、主题、目录选择、openFile/openDiff/reveal 全部通过 |
| GUI（Host 强制 Node 24.18.0） | `status: ready`；Host 进程确认为 Node 24.18.0 |
| staged Runtime（Node 24.18.0） | `prepare-runtime` staging + `--check` 通过；staged smoke 与 GUI 均通过 |
| Node 24.18.0 + npm 11 安装 dsh | staging/smoke 通过；`node-pty` 仍可 spawn；npm 仅提示 `allow-scripts` 警告 |
| 关闭/重开窗口 | Host 存活；重开复用同一进程 |
| `kill -9` Host | 自动重启，`restartCount: 1`；crash JSON 写入 `<userData>/logs/dsh-agent/` |
| SIGTERM 应用 | app 与 Host 均退出，无孤儿进程 |
| 原生依赖 | `node-pty`、`sharp`、`koffi`、`flock` 在 Node 24.18.0 下直接调用通过 |

### 14.3 方案对比

| 方案 | 结果 | 取舍 |
| --- | --- | --- |
| 独立 Node 22.22.1（旧 pin） | 已验证可用 | 需要 CI 单独提供 Node 22.22.1；与 `.nvmrc` 漂移 |
| 独立 Node 24.18.0（当前 pin） | macOS arm64 全链路通过 | **已采用**；与 `.nvmrc` 对齐，CI 可直接复用 |
| Electron 43.7.3 内置 Node | `dsh web` 启动失败 | 不可用 |
| 固定 Electron 43.0.0 / 44.0.0 / 44.7.0 | 指纹可能匹配 | 锁死 Electron 安全升级，不可维护 |
| 去掉 sidecar 改用系统 Node | 版本不可控 | 不可用于发布 |

### 14.4 优化计划

**P0（下次发布构建前）**

- [x] `resources/dsh-agent/runtime.json`：`node` 从 `22.22.1` 改为 `24.18.0`。
- [x] `scripts/dsh-agent/prepare-runtime.mjs`：Node 校验改为精确匹配
      `runtime.json` 的 pin，并校验 `.nvmrc` 与 `runtime.json` 一致；CI 调用
      `prepare-runtime` 时自动生效。
- [x] macOS arm64 用 staged Node 24.18.0 重跑 staging、`--check`、smoke 与 GUI。
- [x] 更新 `docs/dsh-agent/README.md`、`resources/dsh-agent/README.md`、
      `docs/dsh-agent/release.md`、`docs/dsh-agent/operations.md` 中的版本说明。

**P1（全平台启用前）**

- [ ] macOS x64 / Windows x64 用 bundled Node 24.18.0 重跑 `e2e-smoke.mjs`。
- [ ] Windows 原生依赖验证：`node-pty` ConPTY、`sharp`、`koffi`、文件锁路径。
- [ ] 带 API Key 跑真实工具调用、权限审批、取消（F3）。
- [ ] 复核 Linux glibc 基线（Linux 仍为 beta）。
- [ ] `npm run dsh-agent:size` 记录安装包体积变化。

**P2（后续优化）**

- [ ] 首帧 503 竞态：`dshAgentMainService.ts:172-176` 当前先 `load()` 再
      `startHost()`，首帧会显示 503 错误页并产生控制台错误；建议改为 Host
      ready 后首次加载，或先显示明确的 loading 页。
- [ ] 仅当 dsh 发布支持当前 Electron/V8 构建的
      `node-addon-require-builtin` 时，再评估是否移除 sidecar。
- [ ] sidecar 稳定后再评估 Node 载荷裁剪。

### 14.5 变更记录

2026-10-24 分两步完成：

**第一步：文档与分析（已完成）**

- 新增 `docs/dsh-agent/adr-0002-node-runtime.md`。
- 新增 `docs/dsh-agent/changelog.md`。
- `docs/dsh-agent/adr-0001-agent-window.md` 增加 2026-10-24 修订，保留原决策。
- 修正文档中的 Electron 版本：39.8.7 → 43.7.3。
- 更新本计划 §0.1、§0.2、§2 A2、§7.1、§8、§11、§13.3、§13.4。
- 记录本轮复验结果和 Node 24.18.0 评估结论。

**第二步：Node 24.18.0 实施（已完成 macOS arm64 验证）**

- `resources/dsh-agent/runtime.json`：Node pin 改为 `24.18.0`。
- `scripts/dsh-agent/prepare-runtime.mjs`：
  - Node 校验改为与 `runtime.json` 精确匹配；
  - 增加 `.nvmrc` 与 `runtime.json` 一致性检查；
  - 更新 `--check` 的失败信息格式。
- `.gitignore` 补充生成的 `VERSION`、`THIRD_PARTY_NOTICES`、`licenses/`，避免本地 staging 污染工作区。
- 使用临时 npm prefix 安装 dsh 并 staging 到临时目录，`prepare-runtime --check` 通过。
- 分别用 Node 22 的 npm 10、Node 24.18.0 的 npm 11 安装 dsh 并 staging，均通过。
- 使用 staged Node 24.18.0 运行 `e2e-smoke.mjs`，PASS；`node-pty` spawn 正常（npm 11 仅提示 `allow-scripts` 警告）。
- 使用 staged Node 24.18.0 + staged dsh 启动 GUI，`status: ready`，桥接/插件/主题正常。
- 文档同步更新为当前 pin `24.18.0`，并在 `docs/dsh-agent/changelog.md` 记录。

文档漂移说明：本计划 §7.3 原列的 `host.log` / `proxy.log` 当前未单独落地；
实际为 tscode main log 的 `[dshAgent:host]` 条目与
`<userData>/logs/dsh-agent/crash-*.json`，`docs/dsh-agent/operations.md`
已按实际实现描述。§7.3 作为后续可选的日志拆分目标保留。

### 14.6 仍待验证

- Windows x64 设置写入：已定位并修复盘符大小写导致的
  `@deepseek-ai/dsh-app-boot` 双实例与
  `profile reload requires the root Include entry`（见
  `docs/dsh-agent/changelog.md` 2026-10-25）；需在下一构建中复验。
- macOS x64 / Windows x64 的 Node 24.18.0 冒烟与原生依赖（含 Windows 文件锁路径）。
- 真实模型工具调用、权限审批、取消（需要 API Key）。
- Linux glibc 基线与 beta 支持。
- 签名 / 公证 / 安装包 / 更新回滚（E3–E6）。
- 安全评审（D6）与 IPC fuzz（F6）。

---

## 15. dsh fork 与 tscode 集成构建（2026-10-25）

### 15.1 结论

- dsh 运行时来源切换为自维护 fork：
  `AI-Testing-Workbench/testagent-dsh`。
- tscode 不再从公共 npm 安装 `@deepseek-ai/dsh`，而是拉取 fork 打包好的
  tarball artifact。
- 两个仓库保持独立；不使用 submodule、不发布私有 npm、不做 dsh 独立更新器。
- 用户侧仍然只安装和升级一个 tscode，dsh runtime 随 tscode 安装包一起发布。
- fork 构建完成后可以触发 tscode 构建；tscode 构建只消费 artifact，不会反向
  触发 fork。

```text
testagent-dsh/dev
  └─ tscode-runtime.yml
       ├─ pnpm install / build:official
       ├─ release:pack dsh / vendor / landlock
       ├─ write manifest.json + sha256
       ├─ upload artifact: dsh-fork-tarballs
       └─ gh workflow run release.yml
            ├─ dsh_fork_repository
            ├─ dsh_fork_ref
            └─ dsh_fork_run_id

test-workbench-vscode/release.yml
  └─ dsh-runtime job
       ├─ 有 run id：精确拉取该次 fork artifact
       ├─ 无 run id：拉取目标分支最新成功 artifact（默认 dev）
       ├─ 无 artifact：回退该分支源码构建
       ├─ 解析 version / commit
       ├─ 上传为 tscode artifact
       └─ 各平台 job 安装、staging、smoke、打包
```

### 15.2 仓库与分支模型

| 仓库 | 角色 | 当前分支 |
| --- | --- | --- |
| `AI-Testing-Workbench/testagent-dsh` | dsh runtime 源码与打包 | `dev` |
| `AI-Testing-Workbench/test-workbench-vscode` | tscode 产品与集成 | `feat/dev-tscode-dsh`（当前） |

说明：

- fork 的 `dev` 是 runtime 的集成分支；上游同步仍在 fork 内完成。
- tscode 当前在 `feat/dev-tscode-dsh` 上做集成，尚未合并到 `main`。
- fork workflow 的 `TSCODE_REF` 指向 tscode 的目标分支；当前测试期为
  `feat/dev-tscode-dsh`，正式合并后改回 `main`。
- 两个分支名不要混用：
  - `TSCODE_REF` = tscode 的分支；
  - tscode 输入 `dsh_fork_ref` = fork 的分支。

#### 手动触发的前置条件

GitHub 的 `workflow_dispatch` 手动按钮只对**默认分支**上的 workflow 生效。
fork 当前默认分支为 `master`，因此有两种做法：

1. 把 `.github/workflows/tscode-runtime.yml` 单独提交到 `master`，只用于启用
   手动按钮；运行时仍可选择 `dev`。
2. 把 fork 默认分支切换为 `dev`（当前选择 B 方案；需在仓库 Settings 中执行一次）。

切换默认分支不会删除 `master`，但会改变 PR 默认目标和 `origin/HEAD`。

### 15.3 Artifact 契约

fork workflow 产出：

```text
dist/tscode/
  dsh/*.tgz
  dsh/manifest.json
  vendor/*.tgz
  vendor/manifest.json
  landlock/*.tgz
  landlock/manifest.json
```

artifact 名称：`dsh-fork-tarballs`，保留 30 天。

`manifest.json` 结构：

```json
{
  "schemaVersion": 1,
  "version": "0.2.1-rc.3",
  "source": {
    "repository": "AI-Testing-Workbench/testagent-dsh",
    "ref": "<40 位 commit>"
  },
  "packages": [
    { "tarball": "deepseek-ai-dsh-0.2.1-rc.3.tgz", "sha256": "<sha256>" }
  ]
}
```

约束：

- `dsh` family 是 fork 的全部可发布包；tscode 安装端只沿
  `@deepseek-ai/dsh` 的依赖闭包安装，不会把无关的 experimental 包带进
  runtime。
- `vendor` 包含 `cordis` / `cosmokit` / `schemastery` 等 vendored 包。
- `landlock` 目前包含 `@deepseek-ai/node-addon-system` entry；平台 binary
  仍由 npm 按平台解析。若 fork 修改 `native/system`，必须把对应平台包一并
  打包。
- tscode 安装端会校验 manifest 中每个 tarball 的 sha256；没有 manifest 的
  本地目录只打印 warning，不阻断开发。

### 15.4 Fork 侧：构建与触发

文件：`testagent-dsh/.github/workflows/tscode-runtime.yml`

触发：

- `push` 到 `dev`；
- `workflow_dispatch`（可选择任意分支，`dispatch_tscode` 默认 `true`）。

构建步骤：

```bash
pnpm install --frozen-lockfile
pnpm run build:official
pnpm run release:pack --family dsh    --out dist/tscode/dsh    --concurrency 8
pnpm run release:pack --family vendor --out dist/tscode/vendor --concurrency 8
pnpm --dir native/system run build:ts
pnpm --dir native/system/packages/entry pack \
  --pack-destination "$PWD/dist/tscode/landlock"
```

然后生成 manifest、校验 tarball 内 dsh 版本、上传 artifact。

触发 tscode：

```bash
gh workflow run release.yml \
  --repo AI-Testing-Workbench/test-workbench-vscode \
  --ref "$TSCODE_REF" \
  -f platforms=all \
  -f dsh_fork_repository="$GITHUB_REPOSITORY" \
  -f dsh_fork_ref="$GITHUB_REF_NAME" \
  -f dsh_fork_run_id="$GITHUB_RUN_ID"
```

需要的 secret：

| 仓库 | Secret | 权限 |
| --- | --- | --- |
| `testagent-dsh` | `TSCODE_DISPATCH_TOKEN` | tscode Actions: Read and write（或 classic `repo` + `workflow`） |
| `test-workbench-vscode` | `DSH_FORK_TOKEN` | fork Actions: Read-only（或 classic `repo`） |

注意：

- `TSCODE_DISPATCH_TOKEN` 必须放在 fork 仓库，不能放在 tscode。
- 组织仓库的 fine-grained PAT 可能需要组织审批或 SSO 授权。
- fork 自身的 artifact 上传使用 `GITHUB_TOKEN`，不需要额外 secret。

### 15.5 tscode 侧：拉取与集成

文件：

- `.github/workflows/release.yml`
- `.github/workflows/release-darwin-x64.yml`
- `scripts/dsh-agent/install-runtime-from-tarballs.mts`
- `scripts/dsh-agent/prepare-runtime.mjs`
- `resources/dsh-agent/runtime.json`

`workflow_dispatch` 输入：

| 输入 | 默认 | 说明 |
| --- | --- | --- |
| `dsh_fork_repository` | `AI-Testing-Workbench/testagent-dsh` | fork 仓库 |
| `dsh_fork_ref` | `dev` | fork 分支，用于查找最新成功产物 |
| `dsh_fork_run_id` | 空 | 精确 run id；fork 自动触发时传入，手动时留空 |

解析顺序：

1. `dsh_fork_run_id` 有值：直接下载该 run 的 `dsh-fork-tarballs`；
2. 否则查询 `dsh_fork_ref` 上最新一次成功的 `tscode-runtime.yml`；
3. 两者都没有：checkout `dsh_fork_ref` 源码并执行 `build:official` + pack。

下载通过 GitHub API 完成，因为 Actions artifact 不能跨仓库用
`actions/download-artifact` 直接下载：

```bash
gh api repos/$repo/actions/runs/$run_id/artifacts \
  --jq '.artifacts[] | select(.name == "dsh-fork-tarballs") | .id'
gh api repos/$repo/actions/artifacts/$artifact_id/zip > artifact.zip
```

解析出的 `version` / `ref` 作为 `dsh-runtime` job outputs：

- 缓存 key：
  `dsh-agent-runtime-v3-<platform>-<ref>`；
- staging 校验：
  `prepare-runtime.mjs --dsh-version <version> --fork-ref <ref>`；
- 打包后校验使用同一组参数。

### 15.6 安装与 staging

安装脚本：`scripts/dsh-agent/install-runtime-from-tarballs.mts`

流程：

1. 读取 `--from` 目录下的全部 `.tgz`，可选校验 `manifest.json` /
   `SHA256SUMS`；
2. 从 `@deepseek-ai/dsh` 出发，沿
   `dependencies` / `peerDependencies` / `optionalDependencies` 计算闭包；
3. 区分 required 与 optional：
   - 只通过 optional 边到达的包写入根 `optionalDependencies`；
   - 其余写入根 `dependencies`；
4. 生成 `allowScripts`：
   - registry 包按名字；
   - file: tarball 用完整 `file://` URL；
5. 按 `runtime.json` 的 `pnpm` pin 额外安装 pnpm（不依赖用户全局 pnpm）；
6. 执行 `npm install`，不省略 optional 依赖；
7. 显式执行 `@deepseek-ai/dsh-subprocess-local` 的 spawn-helper 修复脚本；
8. 校验 `@deepseek-ai/dsh/lib/bin.js`、
   `@deepseek-ai/dsh-web-frontend/dist/index.html` 和 pnpm 版本。

必须遵守：

- **不要加 `--omit=optional`**：`koffi` 依赖
  `@koromix/koffi-<platform>` 可选包，省略后会尝试源码编译。
- **可选平台包必须保持 optional**：例如
  `@deepseek-ai/dsh-experimental-cua-macos` 是
  `@deepseek-ai/dsh-cua-bundle` 的 optionalDependency。如果被提升为根
  `dependencies`，Windows/Linux 会报：
  `npm error notsup Unsupported platform ...`。
- npm 11.16 默认不执行生命周期脚本；`allowScripts` 必须覆盖需要的包。

staging 脚本：`scripts/dsh-agent/prepare-runtime.mjs`

- 复制 `node_modules`、Node、web frontend、客户端插件到
  `resources/dsh-agent/`；
- 在 `node/bin/pnpm`（Windows 为 `node/pnpm.cmd`）生成 pnpm shim，指向
  `app/node_modules/pnpm`；Host 启动子进程时已把该目录前置到 `PATH`；
- 生成 `VERSION`、`THIRD_PARTY_NOTICES`、`licenses/`；
- `VERSION` 记录 dsh 版本、Node 版本、fork commit；
- `--check` 校验 dsh 版本、Node 版本、fork commit、web、插件、pnpm 版本/
  shim 和 pi-ai dotfile。

`resources/dsh-agent/runtime.json` 仍是本地构建的默认 pin；CI 通过
`--dsh-version` / `--fork-ref` 使用实际 artifact 的版本和 commit。

### 15.7 验证记录

已完成的验证：

| 项目 | 结果 |
| --- | --- |
| fork `build:official` | 通过 |
| fork `release:pack` dsh/vendor/landlock | 通过（364 + 9 + 1 个 tarball） |
| macOS arm64 artifact 安装 | 321 required + 1 optional，共 640 个包 |
| Linux 解析模拟 `--os=linux` | 通过，不再出现 EBADPLATFORM |
| Windows 解析模拟 `--os=win32` | 通过，不再出现 EBADPLATFORM |
| `prepare-runtime` staging + `--check` | 通过 |
| `e2e-smoke.mjs` | PASS（ready、boot、插件、WS、路径穿越、profile） |
| dshAgent 单元测试 | 16 passing |
| workflow YAML / resolver shell | 通过 |

当前待验证：

- Windows x64 / macOS x64 的真实 CI 构建。
- tscode `feat/dev-tscode-dsh` 合并到 `main` 后的自动触发链路。
- fork 修改 `native/system` 时的平台包发布策略。
- 签名、公证与安装包验证（E3–E6）。

### 15.8 常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `HTTP 422: Unexpected inputs provided` | `TSCODE_REF` 指向的分支没有 `dsh_fork_*` 输入 | 合并 tscode 改动，或把 `TSCODE_REF` 指向当前特性分支 |
| `HTTP 403: Resource not accessible` | `TSCODE_DISPATCH_TOKEN` 缺少 tscode Actions 写权限 | 重新生成 fine-grained PAT，授予 Actions: Read and write |
| `HTTP 401: Bad credentials` | token 过期、复制错误或已删除 | 重新生成并更新 fork secret |
| `HTTP 404: Not Found` | token 看不到仓库，或 workflow 不在目标 ref | 检查 token 仓库范围与 `TSCODE_REF` |
| `TSCODE_DISPATCH_TOKEN is not configured` | secret 名字错误、放错仓库或加成了 variable | 在 fork 添加 Repository secret |
| 看不到 **Run workflow** | workflow 不在默认分支 | 把 workflow 文件提交到 `master`，或把默认分支切到 `dev` |
| `DSH_FORK_TOKEN is not configured` | tscode secret 缺失 | 在 tscode 添加 Repository secret |
| `npm error notsup Unsupported platform` | 平台专用可选包被当成必需依赖 | 检查安装脚本的 required/optional 分类 |
| tscode 回退源码构建 | 没有可用 artifact 或 token 权限不足 | 先运行 fork `tscode-runtime`，并检查 `DSH_FORK_TOKEN` |

### 15.9 后续演进

- tscode 集成合并到 `main` 后，把 fork workflow 的 `TSCODE_REF` 改回
  `main`。
- 可选：增加 pin 自动更新脚本或 PR，减少手工同步
  `runtime.json` / `TSCODE_REF`。
- 若 fork 需要独立发布节奏，可评估私有 registry 替代 artifact 拉取。
- 保持“用户只安装 tscode”的产品边界，不引入 dsh 独立更新器。

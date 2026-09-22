<!-- test-workbench_change - new file -->

# CapturedLog 日志截获与上报链路说明

> 本文档说明 TSCode fork 中四类日志来源（`renderer` / `extensionHost` / `webview` / `outputChannel`）的截获实现与上报数据流向。

## 1. 概述

该功能把四类来源的日志统一截获，并通过 Telemetry 通道以事件名 **`capturedLog`** 上报到产品配置的采集端点，用于日志采集与问题排查。

- **统一事件名**：`capturedLog`
- **统一核心字段**：`message`（`TelemetryTrustedValue`）、`logSource`（四个枚举之一）、`logLevel`
- **扩展归属字段**：`extensionId`（扩展 ID）+ `extensionVersion`（扩展版本号）；仅 extensionHost / webview / outputChannel 三条链路携带，各自独立、可缺省
- **链路追踪字段**：`traceId`/`traceIndex`（链路级标识，产生侧赋值，见 4.5）——受 `capturedLog.traceEnabled` 总开关控制。**开关已下沉到产生侧**：关闭时各产生侧跳过栈指纹提取、状态机推进与 RPC 字段，上报事件与不开启链路追踪时完全一致，额外运行时开销归零
- **控制开关**：`product.json` 的 `capturedLog` 配置段（各链路独立开关 + 细粒度维度开关 + 链路追踪总开关 + 日志级别过滤）
- **公共出口**：`ITelemetryService.publicLog('capturedLog', ...)` → TelemetryService → Appender → HTTP POST 到采集端点

## 2. 配置说明（product.json）

```jsonc
"capturedLog": {
    // 四类 logSource 的总开关（数组白名单；也可为字符串 "all" 表示全部启用）
    "logSourceEnabled": ["extensionHost", "webview", "outputChannel", "renderer"],
    // extensionHost / outputChannel 链路的扩展 ID 白名单（与 logSourceEnabled 为 AND 关系）
    "extensionIdEnabled": ["test-tech.hello-plugin-sample"],
    // outputChannel 链路的 channel 名称白名单
    "outputChannelNameEnabled": ["Extension Host"],
    // 链路追踪总开关（默认 false）：为 true 时 capturedLog 事件额外携带
    // traceId/traceIndex 链路字段（见 4.5）；为 false 时上报事件与不开启时完全一致
    "traceEnabled": true,
    // 日志级别过滤（四条链路统一应用，与 logSourceEnabled / extensionIdEnabled 为 AND 关系）：
    // 字符串 "all" 表示所有级别放行；数组仅放行数组内级别（info/warn/error/debug/trace）；
    // 未配置或配置无效时默认全部屏蔽（一条不上报）。过滤判断在各链路 trace 状态机推进
    // （next）之前完成，被过滤日志不占 traceIndex（上报编号连续）、不上报；
    // 原生 console 输出 / 输出通道显示内容均不受影响（仅影响上报数据，见 4.6）
    "logLevelEnabled": ["info", "warn", "error", "debug", "trace"]
}
```

对应的判断函数定义在 `src/vs/platform/product/common/productService.ts`：

| 函数 | 语义 | 配置值语义 |
|---|---|---|
| `isCapturedLogSourceEnabled(productService, logSource)` | 某 logSource 总开关 | 数组包含 或 `'all'` |
| `isCapturedExtensionIdEnabled(productService, extensionId)` | 某扩展 ID 是否启用 | 数组包含 或 `'all'`（值非空串） |
| `isCapturedOutputChannelNameEnabled(productService, outputChannelName)` | 某输出面板名是否启用 | 数组包含 或 `'all'` |
| `isCapturedLogTraceEnabled(productService)` | 链路追踪总开关 | `=== true` |
| `isCapturedLogLevelEnabled(productService, logLevel)` | 某日志级别是否允许上报 | 数组包含 或 `'all'`；其余（含未配置）一律屏蔽 |

## 3. 总体数据流

```
[日志产生点]
 ├─ renderer      : console.* / window error / unhandledrejection
 │                  → console hook → 内存缓冲 → reporter 回调 → publicLog
 ├─ extensionHost : extension host 进程 console hook（标记 reportToTelemetry + extensionId + extensionVersion）
 │                  → RPC $logExtensionHostMessage → 渲染进程 mainThreadConsole → publicLog
 ├─ webview       : webview iframe 内 console hook
 │                  → postMessage('__vscode_log_capture__') → pre 宿主转发
 │                  → '__vscode-log-capture' 事件 → webviewElement → publicLog
 └─ outputChannel : 输出面板文件轮询增量读取 → onAppendedContent 回调 → publicLog
        ↓
 ITelemetryService.publicLog('capturedLog', { message, logSource, logLevel, ... })
        ↓
 TelemetryService 分发给已注册的 ITelemetryAppender
        ↓
 OneDataSystemAppender（1ds SDK，endpointUrl 读 product.extensionTelemetry.endpointUrl）
        ↓
 HTTP POST → 采集端点（当前配置为 base64("http://localhost:8080")）
```

## 4. 各链路详述

### 4.1 renderer（渲染进程）

**涉及文件**
- `src/vs/workbench/contrib/capturedLog/browser/rendererLogCapture.ts`（截获 + 缓冲）
- `src/vs/workbench/electron-browser/desktop.main.ts`（安装入口 + 上报注册）

**实现方法与数据流向**

1. **安装**：`desktop.main.ts` 的 `main()` 中，`isCapturedLogSourceEnabled(product, 'renderer')` 为 `true` 时调用 `installRendererLogCapture(isCapturedLogTraceEnabled(product), product.capturedLog?.logLevelEnabled)`——`traceEnabled` 下沉：关闭时产生侧跳过 trace 状态机推进与栈指纹提取；`logLevelEnabled` 下沉：级别过滤名单传入产生侧（'all' | 级别数组 | undefined），过滤先于 trace 推进。安装成功后会设置调试标记 `console.__testWorkbenchRendererLogCaptureInstalled = true`。
2. **截获**：包装 console 的 12 个方法（`log/info/warn/error/debug/trace/dir/assert/table/count/timeLog/timeEnd`），保留原生行为的同时把参数序列化后交给上报器；另监听 `window 'error'` 与 `'unhandledrejection'` 两个 DevTools 可见的错误输出。
3. **缓冲**：启动早期渲染进程 Telemetry 尚未就绪，截获消息先存入内存缓冲（上限 2000 条，超出则截断并写入一条截断提示）；`registerRendererLogCaptureReporter()` 被调用时一次性 flush 缓冲并转为实时转发。
4. **上报**：`open()` 中 `workbench.startup()` 之后，通过 `instantiationService.invokeFunction(accessor => accessor.get(ITelemetryService))` 获取 Telemetry 服务并注册上报器：

```ts
registerRendererLogCaptureReporter((message, logLevel) => {
    telemetryService.publicLog('capturedLog', {
        message: new TelemetryTrustedValue(message),
        logSource: 'renderer',
        logLevel
    });
});
```

**开关**：仅受 `capturedLog.logSourceEnabled` 含 `'renderer'` 控制，与其他维度无关；`traceEnabled` 在入口下沉为 `installRendererLogCapture` 参数，关闭时跳过 trace 计算；`logLevelEnabled` 在入口下沉为 `installRendererLogCapture` 第二个参数——被过滤级别不推进 trace（不占 traceIndex）、不上报，原生 console 行为不受影响（native 先行，DevTools 仍可见）。

**防重入**：`inReporter` 标志保证上报过程中触发的新 console 输出不再递归截获。

**跨源去重（与 extensionHost 源）**：`sendToReporter` 入口会检查抑制标记 `console.__testWorkbenchSuppressRendererLogCapture`（与 `mainThreadConsole` 约定的 console 属性）。该标记置位时跳过本次上报——**只跳过上报，原生 console 行为不受影响**（DevTools 仍可见）。标记由 `mainThreadConsole` 在"同一消息已按 `extensionHost` 源上报"时置位、写 console 后经 `try/finally` 必清（见 4.2），因此仅消除与 extensionHost 源的重复副本，不丢信息。

### 4.2 extensionHost（扩展宿主）

**涉及文件**
- `src/vs/workbench/api/common/extHostConsoleForwarder.ts`（extension host 进程内截获）
- `src/vs/workbench/api/browser/mainThreadConsole.ts`（渲染进程侧上报）

**实现方法与数据流向**

1. **截获（extension host 进程）**：`ExtHostConsoleForwarder` 包装 console 方法，对可归属到某个扩展调用的消息打上 `reportToTelemetry: true` 标记，并通过调用栈匹配（`_findExtensionInfo`）同时确定 `extensionId`（扩展 ID）与 `extensionVersion`（扩展版本号，取自 `IExtensionDescription.version`）。
2. **传输**：复用现有 RPC 通道 `$logExtensionHostMessage`（`IRemoteConsoleLog`），把 `reportToTelemetry` / `extensionId` / `extensionVersion` 作为附加字段随消息从 extension host 进程传到渲染进程，无需新增通道。
3. **上报（渲染进程）**：`MainThreadConsole.$logExtensionHostMessage` 中判断：

```ts
if (telemetryEntry.reportToTelemetry
    && isCapturedLogSourceEnabled(productService, 'extensionHost')
    && isCapturedExtensionIdEnabled(productService, telemetryEntry.extensionId)
    && isCapturedLogLevelEnabled(productService, logLevel)) {   // 级别过滤（消费侧兜底，见 4.6）
    telemetryService.publicLog('capturedLog', {
        message: new TelemetryTrustedValue(message),
        logSource: 'extensionHost',
        logLevel,               // severity: error/warn/debug → 对应级别，其余 info
        ...(extensionId ? { extensionId } : {}),
        ...(extensionVersion ? { extensionVersion } : {}),
        // 链路追踪（第二阶段）：traceId/traceIndex 由 extensionHost 产生侧赋值并随 RPC 传递，
        // 此处仅在 capturedLog.traceEnabled 开启时携带上报
        ...(isCapturedLogTraceEnabled(productService) && telemetryEntry.traceId
            ? { traceId: telemetryEntry.traceId, traceIndex: telemetryEntry.traceIndex } : {}),
    });
}
```

链路追踪（第二阶段）：`ExtHostConsoleForwarder._handleConsoleCall` 在产生侧维护 `TraceContextState` 状态机——仅在日志归属扩展（`extensionId` 非空）且 `traceEnabled` 开启时按"调用路径指纹 + 时间窗"推进 trace 状态并生成 `traceId`/`traceIndex`（随 RPC 消息传递）。

**开关（产生侧下沉）**：`logSourceEnabled` 含 `'extensionHost'` **AND** `extensionIdEnabled` 放行该扩展 ID（AND 关系，双重条件同时满足才上报）**AND** `logLevelEnabled` 放行该级别。三者由渲染进程从 product.json 合成后经 `IExtensionHostInitData.capturedLog` 传入 extension host 进程：`logSourceEnabled` 关闭或无有效 `extensionIdEnabled` 名单时，产生侧**跳过调用栈反查**（省去每次 console 调用的栈捕获与扩展路径匹配），上报字段保持 undefined；名单过滤同步在产生侧完成（与渲染进程 `isCapturedExtensionIdEnabled` 语义一致），渲染进程判断保留作防御。`logLevelEnabled` 过滤（方案 2）在产生侧先于 trace 状态机推进（next）执行：被过滤级别跳过栈捕获、extensionId 反查与 trace 推进（不占 traceIndex），`reportToTelemetry` 置 `false`——`$logExtensionHostMessage` 照常发送（DevTools "Extension Host" 镜像保留）、`_nativeConsoleLogMessage` 照常调用（插件进程原生 stdout/stderr 保留），控制台显示零变化，仅影响 telemetry 上报；渲染进程 `isCapturedLogLevelEnabled` 判断保留作兜底（旧版本 extension host 进程未过滤时也能拦住）。

**去重（与 renderer 源）**：扩展宿主的 console 消息经 RPC 到达后，`MainThreadConsole` 除上报 `extensionHost` 源外，还会 `log(entry, 'Extension Host')` 写入渲染进程 console——该输出会被 renderer 源再次截获上报，导致同一条消息两个 `logSource` 各报一次。方案 1：当本消息按 `extensionHost` 源上报成功时（上述 AND 条件满足），在写 console 期间调用 `setRendererLogCaptureSuppressed(true)` 置位抑制标记（`console.__testWorkbenchSuppressRendererLogCapture`），renderer 源 hook 检测到即跳过本次上报；`try/finally` 包住 `log()` 全过程（含 `_isExtensionDevTestFromCli` 分支与异常路径），保证标志必清、不残留。**仅当 extensionHost 源真的上报了才抑制**：若 `logSourceEnabled` 不含 `'extensionHost'` 或 `extensionIdEnabled` 不放行该扩展 ID，则不置位，renderer 源照常兜底上报。

### 4.3 webview（内嵌网页）

**涉及文件**
- `src/vs/workbench/contrib/webview/browser/pre/index.html`（截获脚本注入 + 宿主转发）
- `src/vs/workbench/contrib/webview/electron-browser/webviewElement.ts`（主线程接收上报）
- `src/vs/workbench/contrib/webview/browser/webviewElement.ts`（基类，定义 `handleLogCapture`）

**实现方法与数据流向**

1. **截获（webview iframe 文档内）**：`index.html` 的 `getLogCaptureScript(traceEnabled, logLevels)` 生成截获脚本，注入 iframe 文档 `<head>` 最前（先于 vscode API 脚本加载），包装 console 方法（`log/info/warn/error/debug/trace/dir/assert`）并监听 `unhandledrejection`/`error`，序列化后 `postMessage({ source: '__vscode_log_capture__', message, logLevel, traceId?, traceIndex? })` 发送给宿主窗口。链路追踪（第二阶段）：截获脚本（产生侧）维护内联 `TraceContextState` 状态机，按"调用路径指纹 + 时间窗"生成链路字段；`traceEnabled` 由宿主透传（`options.logCaptureTraceEnabled`），关闭时脚本以 `TRACE_ENABLED` 常量短路，跳过栈捕获与状态机推进。级别过滤（方案 2）：`logLevels` 由宿主透传（`options.logCaptureLogLevels`，'all' | 级别数组 | undefined），脚本以 `LOG_LEVEL_ENABLED` 常量 + `isLogLevelAllowed` 判断——过滤先于 `safeTraceFields`（trace 推进）执行，被过滤日志不占 traceIndex（编号连续）且不发送 postMessage（上报归零；webview 自身 console 输出不受影响，native 已先行执行）。
2. **转发（pre 宿主）**：宿主监听 message 事件，收到 `__vscode_log_capture__` 后通过 `hostMessaging.postMessage('__vscode-log-capture', { message, logLevel, traceId?, traceIndex? })` 原样透传链路字段给 vscode 主线程。
3. **上报（渲染进程主线程）**：`webviewElement.ts` 中 `on('__vscode-log-capture')` → `handleLogCapture`（取 `this.extension?.id.value` 作为 `extensionId`，并经 `IExtensionService.getExtension` 异步查询扩展版本 `extensionVersion`，结果按扩展 ID 缓存、仅首次异步）→ `isCapturedLogSourceEnabled(productService, 'webview')` 判断通过后 `publicLog('capturedLog', { message, logSource: 'webview', logLevel, extensionId?, extensionVersion?, traceId?, traceIndex? })`。链路字段由截获脚本产生侧赋值并随消息透传，上报时按 `traceEnabled` 决定是否携带。

**开关（注入决策下沉）**：截获脚本是否注入由宿主 `webviewElement` 在发送 content 时合成（`options.logCaptureEnabled = logSourceEnabled 含 'webview' AND extensionIdEnabled 放行该 webview 归属扩展`）——关闭时不注入截获脚本，webview 内 console 包装与 postMessage 链路整体归零；`traceEnabled` 透传为 `options.logCaptureTraceEnabled` 控制脚本内 traceId 计算；`logLevelEnabled` 透传为 `options.logCaptureLogLevels` 控制脚本内级别过滤（过滤先于 trace 推进，被过滤日志不占 traceIndex）。宿主 `handleLogCapture` 另保留一处 `isCapturedLogLevelEnabled` 兜底判断（防止旧版本 pre 脚本未过滤时漏出），仅影响上报。

### 4.4 outputChannel（输出面板）

**涉及文件**
- `src/vs/workbench/contrib/output/browser/outputServices.ts`（注入上报回调）
- `src/vs/workbench/contrib/output/common/outputChannelModel.ts`（文件轮询增量截获）

**实现方法与数据流向**

1. **截获（model 层）**：`AbstractFileOutputChannelModel` 通过文件轮询增量读取（`appendContent`），读取到的内容无论模型是否已加载都交给 `onAppendedContent` 回调；`DelegatedOutputChannelModel` 把内部模型读到的增量转发给上层回调；构造函数兜底调用 `outputContentProvider.watch()` 并注册 `onDidAppend`/`onDidReset`，保证 channel 从未打开时增量也能被截获。
2. **上报（OutputChannel 构造）**：model 为 `AbstractFileOutputChannelModel` 或 `DelegatedOutputChannelModel` 时注入 `this.model.onAppendedContent = content => this.reportOutputChannelLog(content)`。
3. **排除递归**：Telemetry 日志 channel（`id === telemetryLogId` 或 label 为 `'Telemetry'`/`'遥测'`）不上报，避免"截获 → 上报 → 写回该 channel → 再截获"的无限循环。
4. **判断与上报**：

```ts
if (isCapturedLogSourceEnabled(productService, 'outputChannel')
    && (isCapturedExtensionIdEnabled(productService, extensionId)
        || isCapturedOutputChannelNameEnabled(productService, label))) {
    const extensionVersion = await getExtensionVersion(extensionId); // IExtensionService 按扩展 ID 查询并缓存
    const cleanContent = content.replace(/(\r?\n)+$/, ''); // 清理文件行尾换行（仅尾部）
    const logLevel = parseLogLevel(cleanContent);           // 解析行首 [level] 标记（纯函数，无副作用）
    // 级别过滤（方案 2，四条链路统一应用）：过滤判断先于 trace 状态机推进（next）——
    // 被过滤日志不占 traceIndex（编号连续）且不上报；日志文件内容本身不受影响（输出通道显示零变化）
    if (!isCapturedLogLevelEnabled(productService, logLevel)) {
        return;
    }
    const traceEnabled = isCapturedLogTraceEnabled(productService);          // traceEnabled 下沉
    const traceFields = traceEnabled ? traceContext.next(undefined) : undefined;
    telemetryService.publicLog('capturedLog', {
        message: new TelemetryTrustedValue(cleanContent),
        logSource: 'outputChannel',
        logLevel,
        extensionId: extensionId,
        ...(extensionVersion ? { extensionVersion } : {}),
        outputChannelName: label,
        ...(traceFields ? { traceId: traceFields.traceId, traceIndex: traceFields.traceIndex } : {})
    });
}
```

**开关**：`logSourceEnabled` 含 `'outputChannel'`，且 `extensionIdEnabled`（按扩展 ID）与 `outputChannelNameEnabled`（按 channel 名称）**二选一满足**（OR），再与前者做 AND；`logLevelEnabled` 放行解析出的级别（与 logSourceEnabled 为 AND，过滤先于 trace 推进，被过滤日志不占 traceIndex 且不上报，输出通道显示零变化）。

**链路追踪（第二阶段）**：每个 OutputChannel 实例在 `reportOutputChannelLog` 中维护独立的 `TraceContextState` 状态机——文件轮询增量读取无业务调用栈，仅按**时间窗**判定流程边界（`TRACE_WINDOW_MS`（3s）内连续读取的追加内容视为同一次处理流程）；`traceEnabled` 下沉：关闭时跳过状态机推进，仅按原逻辑上报（不带 `traceId`/`traceIndex`）。

### 4.5 链路追踪字段（traceEnabled）

链路追踪为**单 traceId 顺序编号模型**，字段含义：

- **traceId**：同一次"业务代码处理流程"产生的日志共享同一个 `traceId`，用于聚合一次流程的全部日志；
- **traceIndex**：同一 `traceId` 内按产生顺序从 **1 开始递增** 的编号（1, 2, 3, ...），用于对同一次流程的捕获消息排序——即使上报/传输乱序，也能按 `traceIndex` 还原原始产生顺序。

> **为什么没有 spanId / parentSpanId**：在全链路追踪（如 OpenTelemetry）中，`spanId`/`parentSpanId` 的语义是标识**多个处理节点（进程/服务）**的先后顺序与父子调用关系。本场景是同一进程内的一条消息流（同一处理节点的多条顺序消息），没有多节点概念，因此不采用这两个字段；用 `traceIndex` 直接表达同 trace 内消息的顺序即可。

**流程边界判定（产生侧）**：console 截获点看不到业务流程的进入/退出，故用"**调用路径指纹 + 时间窗**"近似（共享实现 `src/vs/base/common/traceContext.ts` 的 `TraceContextState.next(stackKey)`）：

- 与上一条日志的调用路径指纹一致（同一调用路径），且间隔 ≤ `TRACE_WINDOW_MS`（3s），视为同一次流程的延续（`traceId` 不变，`traceIndex` 递增）；
- 调用路径指纹不可得（outputChannel 文件轮询读取）时，仅按时间窗判定；
- 否则开启新 trace（新 `traceId`，`traceIndex` 从 1 重新开始）。

`TRACE_WINDOW_MS` 取 3s 的平衡点：
- 过短（如 1s）会把一次流程中的异步步骤（`await`、定时任务、outputChannel 文件轮询读取批次等）误拆成多个 `traceId`；
- 过长（如 30s）会把"调用路径指纹"近似的不同业务流误合并——同一文件内的不同命令（匿名函数帧无函数名、去掉行列号后不可区分）加上相同的框架帧，指纹完全相同（实测两个命令间隔约 2.5s 被误合并成同一条 trace；该场景已由"命令边界重置 traceId"解决，见下）。

时间窗只是近似边界，与调用路径指纹配合使用，无法做到与业务语义完全一致。

**命令边界重置（extensionHost 链路）**：纯"指纹 + 时间窗"无法区分同一文件内的两次不同命令调用（匿名回调指纹相同）。extensionHost 链路因此补一层**显式边界**——`extHostCommands._executeContributedCommand` 在每次扩展命令执行前调用 `resetTraceContext()`（本命令日志从 traceIndex 1 开始独立成 trace），命令结束（finally）再调用一次（隔离下一条命令，即使指纹相同、间隔在时间窗内也不会被误合并）。副作用：命令内未 await 的异步日志（命令返回后才执行）会被归入新 trace——语义上正确，那是命令结束后的后台任务。renderer / webview / outputChannel 三条链路拿不到命令边界，维持"指纹 + 时间窗"判定。

调用路径指纹 = 调用栈跳过截获层自身帧、去掉行号列号后的前 3 帧（`extractStackKey`），同一函数内不同调用点视作同一调用路径。

**各链路接入**：

| 链路 | 产生侧（赋值点） | 指纹来源 | 传递路径 |
|---|---|---|---|
| renderer | `rendererLogCapture.ts` 截获点 | 本次调用栈 / 错误对象栈 | 回调参数 → publicLog |
| extensionHost | `extHostConsoleForwarder._handleConsoleCall`（仅 `extensionId` 非空时） | 共享待匹配栈或当前调用栈 | RPC → mainThreadConsole |
| webview | pre/index.html 截获脚本（内联状态机） | 本次调用栈 / 错误对象栈 | postMessage → 宿主透传 |
| outputChannel | `outputServices.reportOutputChannelLog`（每 channel 独立状态机） | 无（仅时间窗） | 同进程 publicLog |

**开关**：`capturedLog.traceEnabled`（默认 false）。各产生侧**始终**生成链路字段（开销为每次截获一次 UUID 与栈指纹，可忽略）；是否**携带上报**由渲染进程各上报点按 `isCapturedLogTraceEnabled` 决定——关闭时四上报点不携带任何链路字段，上报事件与不开启链路追踪时逐字节一致。

**纪律**：trace 系列字段必须在**产生侧**赋值（扩展宿主截获点、webview 截获脚本、outputChannel 截获点、renderer 截获点），随 RPC / postMessage 传递；禁止在渲染进程按到达顺序补值（到达顺序 ≠ 逻辑顺序）。extensionHost 链路仅在日志归属扩展（`extensionId` 非空）时推进状态，避免扩展宿主自身日志污染插件链路。`logLevelEnabled` 级别过滤同样必须在**产生侧、trace 状态机推进（next）之前**完成——被过滤日志不调用 `next()` 故不占 `traceIndex`（编号连续）；若在 `next()` 之后（如消费侧 publicLog 前）过滤，已推进的编号会造成 traceIndex 空洞。

**链路边界**：四条链路的 trace 上下文相互独立（各进程/各上下文各自成链），traceId 仅在同一链路内保证"同一次处理流程"聚合；跨链路关联（如 extensionHost 日志与 webview 日志串成一条）不在当前范围内。

### 4.6 日志级别过滤（logLevelEnabled）

`logLevelEnabled` 为四条链路统一应用的级别过滤配置（与 `logSourceEnabled` / `extensionIdEnabled` / `outputChannelNameEnabled` 均为 AND 关系），取值：

- **`'all'`**：所有级别放行（等价于不开启过滤）；
- **级别数组**（`['info','warn','error','debug','trace']` 的子集）：仅放行数组内级别，过滤级别完全不上报；
- **未配置 / 无效值 / 空数组**：**全部屏蔽**（与 `extensionIdEnabled` 的 none 语义一致）——注意：启用其他 capturedLog 配置但漏配 `logLevelEnabled` 时，将一条都不上报。

**过滤点（全部在产生侧、trace 状态机推进（next）之前，被过滤日志不占 traceIndex）**：

| 链路 | 过滤点 | 说明 |
|---|---|---|
| renderer | `rendererLogCapture.ts` 的 `logToReporter` | 过滤先于 `computeTrace`（惰性求值），被过滤日志跳过栈捕获与状态机推进、不上报 |
| extensionHost | `extHostConsoleForwarder._handleConsoleCall` 开头 | 方案 2：被过滤级别跳过栈捕获 / extensionId 反查 / trace 推进，`reportToTelemetry` 置 false——RPC 镜像与原生 stdout/stderr 照常（控制台显示零变化） |
| webview | pre/index.html 截获脚本 `isLogLevelAllowed` | 过滤先于 `safeTraceFields`（trace 推进），被过滤日志不发送 postMessage（上报归零，webview 自身 console 输出不受影响） |
| outputChannel | `outputServices.reportOutputChannelLog` | `_parseLogLevel`（纯函数）提前到 `next()` 之前判断，被过滤日志不占 traceIndex、不上报，日志文件内容不受影响 |

**兜底（消费侧）**：`mainThreadConsole.$logExtensionHostMessage` 与 webview 宿主 `handleLogCapture` 各保留一处 `isCapturedLogLevelEnabled` 判断，用于拦截旧版本产生侧（extension host 进程 / pre 脚本）未做过滤时的漏出，仅影响上报。

**显示零变化**：方案 2 下过滤只影响上报数据，不影响任何显示面——DevTools "Extension Host" 镜像、Output 面板 "Extension Host" 通道、插件进程原生 stdout/stderr、webview / renderer 自身 console 均与不过滤时逐字节一致。

## 5. 统一上报出口

四条链路最终都调用 `ITelemetryService.publicLog('capturedLog', payload)`：

- TelemetryService 将事件分发给已注册的 `ITelemetryAppender` 列表（含 `OneDataSystemAppender` 等）。
- `OneDataSystemAppender`（1ds SDK）的 `endpointUrl` 由 fork 改为从 `product.extensionTelemetry.endpointUrl` 读取，最终以 HTTP POST 上报。
- 上报事件天然携带 Telemetry 公共属性（`common.userId`、`common.userName` 等），同一 session 内与 `extensionActivationTimes` 等事件同一实例。

当前 `product.json` 中 `extensionTelemetry.endpointUrl` 为 `aHR0cDovL2xvY2FsaG9zdDo4MDgw`（base64，解码为 `http://localhost:8080`），即本地采集端点。

## 6. 日志级别映射（四链路统一）

| console 方法 / severity | logLevel |
|---|---|
| `error`、severity=`error` | `error` |
| `warn`、`assert`（失败时，与原生语义一致）、severity=`warn` | `warn` |
| `debug`、severity=`debug` | `debug` |
| `trace` | `trace` |
| 其余（`log/info/dir/table/count/timeLog/timeEnd`、severity=`info`） | `info` |

## 7. 性能与安全设计

- **零开销默认**：仅在对应配置启用时才安装 hook / 监听，未启用时各模块不产生任何行为。
- **级别过滤零净开销**：放行日志每次 console 调用多一次集合判断（纳秒级）；被过滤日志反而省掉栈捕获、extensionId 反查、trace 推进与上报（`'all'` 时短路为零开销）。
- **缓冲上限**：renderer 启动期缓冲上限 2000 条，超出截断，防止内存膨胀。
- **防重入**：renderer 上报过程用 `inReporter` 标志防止递归截获。
- **跨源去重**：extensionHost 源上报成功后，同一消息的 renderer 源副本通过抑制标记（`console.__testWorkbenchSuppressRendererLogCapture`）跳过上报——仅跳过上报、不改变原生 console 行为；标志由 `try/finally` 必清，不残留。
- **防循环**：outputChannel 排除 Telemetry 自身 channel，避免上报日志写回后被再次截获。
- **数据可信**：`message` 统一用 `TelemetryTrustedValue` 包装，明确为可信数据。
- **链路追踪开关**：`traceEnabled` 默认关闭；关闭时四上报点不携带任何链路追踪字段，上报事件与不开启链路追踪时逐字节一致。trace 上下文在产生侧生成（每次截获多一次 UUID 与栈指纹计算，量级可忽略）。

## 8. 调试与验证

1. 确认 `product.json` 的 `capturedLog` 配置已启用对应 `logSource`，重启窗口生效。
2. **renderer**：DevTools Console 执行 `console.__testWorkbenchRendererLogCaptureInstalled`，为 `true` 表示 hook 已安装。
3. 在对应来源制造日志（如 `console.log('captured-log-test')`），观察采集端点（如本地 collector / ELK）是否收到 `logSource` 字段匹配的事件。
4. 若某条链路上报缺失，按链路排查：配置判断 → 截获点是否生效 → 缓冲/转发 → `publicLog` → Appender 网络上报。

## 9. 涉及文件清单

| 链路 | 文件 |
|---|---|
| 公共 | `src/vs/platform/product/common/productService.ts`（五个判断函数，含 `isCapturedLogLevelEnabled`） |
| 公共 | `src/vs/base/common/product.ts`（`capturedLog` 配置类型，含 `traceEnabled` / `logLevelEnabled`） |
| 公共 | `src/vs/base/common/traceContext.ts`（链路追踪共享状态机 `TraceContextState` / `extractStackKey` / `ITraceFields`） |
| 公共 | `product.json`（`capturedLog` 配置、`extensionTelemetry.endpointUrl`） |
| renderer | `src/vs/workbench/contrib/capturedLog/browser/rendererLogCapture.ts` |
| renderer | `src/vs/workbench/electron-browser/desktop.main.ts` |
| extensionHost | `src/vs/workbench/api/common/extHostConsoleForwarder.ts` |
| extensionHost | `src/vs/workbench/api/browser/mainThreadConsole.ts` |
| webview | `src/vs/workbench/contrib/webview/browser/pre/index.html` |
| webview | `src/vs/workbench/contrib/webview/electron-browser/webviewElement.ts` |
| webview | `src/vs/workbench/contrib/webview/browser/webviewElement.ts` |
| outputChannel | `src/vs/workbench/contrib/output/browser/outputServices.ts` |
| outputChannel | `src/vs/workbench/contrib/output/common/outputChannelModel.ts` |

# AionUI 调试步骤

## 测试步骤

1. **启动 VS Code**
   ```bash
   open VSCode-darwin-arm64/Code\ -\ OSS.app
   ```

2. **打开开发者工具**
   - 在 VS Code 主窗口中按 `Cmd+Option+I` 打开 DevTools
   - 切换到 Console 标签页

3. **打开 AionUI 窗口**
   - 按 `Cmd+Shift+P` 打开命令面板
   - 输入 "AionUI" 并选择 "Open AionUI Window"

4. **收集日志**

   a. **VS Code 主进程日志**（在 DevTools Console 中）
   - 查找所有包含 "AionUI" 的日志消息
   - 特别关注：
     - `=== launchAionUIAsProcess START ===`
     - `Process spawned, PID:`
     - `AionUI stdout:` 或 `AionUI stderr:`
     - `process exited`

   b. **AionUI 进程日志文件**
   ```bash
   cat /tmp/aionui-vscode.log
   ```

## 预期看到的日志

### 成功启动的情况：
```
[main] === launchAionUIAsProcess START ===
[main] Mode check: { isProduction: true, isDevelopment: false }
[main] AionUIWindowManager#launchAionUIAsProcess - production mode
[main] About to spawn process...
[main] Process spawned, PID: 12345
[main] AionUI logs will be written to: /tmp/aionui-vscode.log
```

然后在 `/tmp/aionui-vscode.log` 中应该看到：
```
=== AionUI Launch Log (2026-03-30...) ===
[spawn] electronPath: /path/to/electron
[spawn] aionuiMain: /path/to/index.cjs
[spawn] cwd: /path/to/aionui
[spawn] AIONUI_E2E_TEST: 1
[spawn] PID: 12345
[stdout] [AionUi] ========================================
[stdout] [AionUi] STARTUP - Single instance lock check
[stdout] [AionUi] ========================================
[stdout] [AionUi] isE2ETestMode: true
[stdout] [AionUi] AIONUI_E2E_TEST env: 1
[stdout] [AionUi] Got the lock: true
[stdout] [AionUi] ✅ Single instance lock acquired, continuing startup...
[stdout] [AionUi] Setting up app.whenReady() handler...
[stdout] [AionUi] app.whenReady() fired, calling handleAppReady...
[stdout] [AionUi] ========================================
[stdout] [AionUi] handleAppReady called
[stdout] [AionUi] ========================================
```

### 失败的情况（窗口消失）：
如果看到：
```
[stdout] [AionUi] ❌ Another instance is already running; current process will exit.
[exit] code=0, signal=null
```
说明单实例锁定仍然生效。

如果看到：
```
[exit] code=0, signal=null
```
但没有其他日志，说明进程启动后立即退出，需要查看退出原因。

## 故障排查

### 问题 1: 单实例锁定仍然生效
**症状**: 日志显示 "Another instance is already running"
**解决方案**:
- 检查环境变量是否正确传递
- 确认 `AIONUI_E2E_TEST=1` 在日志中显示

### 问题 2: 进程立即退出，无日志
**症状**: 只看到 `[exit] code=0` 但没有 stdout 输出
**可能原因**:
- Electron 二进制路径错误
- AionUI 主入口文件路径错误
- 缺少必要的依赖

### 问题 3: 窗口闪现后消失
**症状**: 看到窗口但立即关闭
**可能原因**:
- 渲染进程崩溃
- 主进程初始化失败
- 查看完整的 stdout/stderr 日志

## 下一步

根据收集到的日志，我们可以：
1. 确认环境变量是否正确传递
2. 确认进程是否真的启动
3. 确认 AionUI 的启动流程在哪里失败
4. 针对性地修复问题

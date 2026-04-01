# AionUI 调试指南

## 快速开始

### 1. 启动 AionUI（自动打开 DevTools）

```bash
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui
```

现在 DevTools 会自动打开！

### 2. 使用调试脚本

```bash
# 查看当前状态和错误
./check-aionui-errors.sh

# 启动并实时监控日志
./test-aionui-with-logs.sh
```

## 在 DevTools 中查找问题

### Console 标签
查看 JavaScript 错误和警告：

**常见错误类型：**
1. **网络错误** - 资源加载失败
   ```
   Failed to load resource: net::ERR_FILE_NOT_FOUND
   ```

2. **JavaScript 错误** - 代码执行错误
   ```
   Uncaught TypeError: Cannot read property 'xxx' of undefined
   ```

3. **IPC 错误** - 主进程通信错误
   ```
   Error invoking remote method 'xxx'
   ```

### Network 标签
检查资源加载：

1. 查看哪些文件加载失败（红色）
2. 检查文件路径是否正确
3. 查看协议（应该是 `vscode-file://`）

### Sources 标签
检查文件是否存在：

1. 展开 `vscode-file://` 协议
2. 查看 `out/aionui/dist/` 目录
3. 确认所有文件都在

## 常见问题排查

### 问题 1: 窗口打开但是空白

**症状：** AionUI 窗口打开，但内容是空白的

**检查：**
1. 打开 DevTools Console
2. 查看是否有 JavaScript 错误
3. 检查 Network 标签，看哪些资源加载失败

**可能原因：**
- React 应用初始化失败
- 关键 JavaScript 文件加载失败
- CSS 文件加载失败

### 问题 2: 某些功能不工作

**症状：** 窗口显示正常，但某些按钮或功能无响应

**检查：**
1. Console 中是否有错误
2. 点击功能时是否有新的错误出现
3. Network 标签中是否有 API 请求失败

**可能原因：**
- IPC 通信问题
- 缺少必要的 API 实现
- 权限问题

### 问题 3: 资源加载失败

**症状：** Console 显示 `Failed to load resource`

**检查：**
1. 查看失败的资源路径
2. 确认文件是否存在于打包目录
3. 检查协议是否正确（应该是 `vscode-file://`）

**解决方法：**
```bash
# 验证文件是否存在
ls -la "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/dist/renderer/"

# 重新打包
./scripts/build-vscode-with-aionui.sh
```

## 详细日志分析

### 查看主进程日志

```bash
# 找到最新的日志文件
LOG_DIR="$HOME/Library/Application Support/Code - OSS/logs"
LATEST_LOG=$(find "$LOG_DIR" -name "main.log" -type f -print0 | xargs -0 ls -t | head -n 1)

# 查看 AionUI 相关日志
grep -i "aionui" "$LATEST_LOG"

# 查看错误
grep -i "error" "$LATEST_LOG" | grep -i "aionui"
```

### 启动时的关键日志

成功启动应该看到：
```
[main] AionUIWindowManager#launchAionUI - launching AionUI in production mode
[main] AionUIWindowManager#launchAionUIInProcess {
  indexExists: true,
  preloadExists: true
}
[main] AionUIWindowManager - registered IPC handler for bridge adapter
[main] AionUIWindowManager - DevTools opened for debugging
[main] AionUIWindowManager#launchAionUIInProcess - successfully loaded index.html
[main] AionUIWindowManager#launchAionUIInProcess - AionUI window created
```

## 对比单独启动

### 单独启动 AionUI（开发模式）

```bash
cd extensions/aionui-main
bun run start
```

这会启动完整的 AionUI 应用，包括：
- 完整的主进程初始化
- 所有 IPC 处理器
- 完整的 bridge adapter
- 所有后台服务

### 在 VS Code 中启动（集成模式）

```bash
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui
```

这是简化版本，只包括：
- 基本的窗口创建
- 简化的 IPC 处理器
- 基本的 bridge adapter

**功能差异：**
- ✅ 基本 UI 显示
- ✅ 基本交互
- ⚠️ 某些高级功能可能不可用（需要完整的主进程服务）

## 收集调试信息

如果需要报告问题，请收集以下信息：

### 1. 控制台错误截图
在 DevTools Console 中截图所有红色错误

### 2. Network 失败请求
在 DevTools Network 中截图所有红色（失败）的请求

### 3. 主进程日志
```bash
# 导出日志
LOG_DIR="$HOME/Library/Application Support/Code - OSS/logs"
LATEST_LOG=$(find "$LOG_DIR" -name "main.log" -type f -print0 | xargs -0 ls -t | head -n 1)
grep -i "aionui" "$LATEST_LOG" > aionui-main-log.txt
```

### 4. 文件验证
```bash
# 验证打包文件
./scripts/verify-aionui-package.sh > package-verification.txt
```

## 高级调试

### 启用更详细的日志

```bash
# 启动时添加环境变量
ELECTRON_ENABLE_LOGGING=1 "../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui --verbose
```

### 检查 IPC 通信

在 DevTools Console 中运行：
```javascript
// 测试 IPC 通信
window.electronAPI.emit('test', { message: 'hello' })
  .then(result => console.log('IPC Success:', result))
  .catch(error => console.error('IPC Error:', error));
```

### 检查 Preload 脚本

在 DevTools Console 中运行：
```javascript
// 检查 electronAPI 是否存在
console.log('electronAPI:', window.electronAPI);
console.log('Available methods:', Object.keys(window.electronAPI));
```

## 修复常见问题

### 修复 1: 重新打包

```bash
# 完整重新构建
./scripts/build-vscode-with-aionui.sh

# 验证
./scripts/verify-aionui-package.sh
```

### 修复 2: 清理缓存

```bash
# 关闭应用
pkill -f "Code - OSS"

# 清理缓存
rm -rf "$HOME/Library/Application Support/Code - OSS/Cache"
rm -rf "$HOME/Library/Application Support/Code - OSS/CachedData"

# 重新启动
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui
```

### 修复 3: 更新集成代码

```bash
# 复制最新的窗口管理器
cp src/vs/aionui/electron-main/aionuiWindowManager.js \
   "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/aionui/electron-main/"
```

## 获取帮助

如果问题仍然存在，请提供：

1. **错误截图** - DevTools Console 的完整截图
2. **日志文件** - 主进程日志中的 AionUI 相关部分
3. **复现步骤** - 详细的操作步骤
4. **环境信息** - macOS 版本、VS Code 版本等

这样可以更快地定位和解决问题！

# 🧪 立即测试 AionUI

## 最新修复

修复了 IPC 处理器重复注册的问题：
- 在初始化前检查处理器是否已存在
- 如果已存在，跳过初始化，使用现有的处理器
- 避免了重复注册导致的错误

## 测试步骤

### 1. 启动应用

```bash
~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/MacOS/Code\ -\ OSS
```

### 2. 打开 AionUI（第一次）

1. 按 `Cmd+Shift+P` 打开命令面板
2. 输入 "Open AionUI"
3. 按回车

**预期结果：**
- ✅ 窗口成功打开
- ✅ 显示 AionUI 界面
- ✅ 至少显示一个 agent（Gemini）
- ✅ 日志中显示 "✅ AionUI backend initialized successfully"

### 3. 关闭 AionUI 窗口

点击窗口的关闭按钮

### 4. 再次打开 AionUI（第二次）

1. 按 `Cmd+Shift+P` 打开命令面板
2. 输入 "Open AionUI"
3. 按回车

**预期结果：**
- ✅ 窗口成功打开
- ✅ 显示 AionUI 界面
- ✅ 日志中显示 "IPC handler already registered, skipping backend initialization"
- ❌ 不应该出现 "Attempted to register a second handler" 错误

### 5. 测试功能

在 AionUI 窗口中：
1. 选择 Gemini agent
2. 输入一条消息
3. 查看是否有回复

## 查看日志

### 方式 1：开发者工具

1. 在 VS Code 主窗口中，按 `Cmd+Shift+I` 打开开发者工具
2. 切换到 Console 标签
3. 查找包含 "AionUI" 的日志

### 方式 2：主进程日志

```bash
# 查看最新的日志文件
ls -lt ~/Library/Application\ Support/Code\ -\ OSS/logs/ | head -5

# 查看日志内容
cat ~/Library/Application\ Support/Code\ -\ OSS/logs/*/main.log | grep AionUI
```

## 成功标志

### 第一次打开

```
[main] AionUIWindowManager - Initializing AionUI backend system...
[main] AionUIWindowManager - Loading process module...
[main] AionUIWindowManager - Using CommonJS require
[main] AionUIWindowManager - ✅ AionUI backend initialized successfully
[main] AionUIWindowManager - BrowserWindow created
```

### 第二次打开

```
[main] AionUIWindowManager - IPC handler already registered, skipping backend initialization
[main] AionUIWindowManager - Using existing backend initialization
[main] AionUIWindowManager - BrowserWindow created
```

## 失败标志

如果看到以下错误，说明修复未生效：

```
❌ Attempted to register a second handler for 'office-ai-bridge-adapter'
```

## 故障排除

### 问题：仍然出现重复注册错误

**解决方案：**
1. 完全退出 VS Code
2. 重新启动应用
3. 再次测试

### 问题：窗口打开但没有内容

**解决方案：**
1. 打开开发者工具（在 AionUI 窗口中按 `Cmd+Shift+I`）
2. 查看 Console 中的错误
3. 检查 Network 标签，确认资源加载成功

### 问题：无法发送消息

**解决方案：**
1. 检查 IPC 通信是否正常
2. 在开发者工具 Console 中运行：
   ```javascript
   window.electronAPI.emit('subscribe-acp.get-available-agents', { id: 'test' })
   ```
3. 查看是否有响应

## 下一步

如果所有测试通过：
- ✅ 集成成功！
- 📝 更新文档
- 🎉 开始使用 AionUI

如果测试失败：
- 📋 记录错误信息
- 🔍 查看日志
- 🐛 继续调试

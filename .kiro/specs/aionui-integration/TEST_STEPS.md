# AionUI 完整后端测试步骤

## 快速测试（5 分钟）

### 步骤 1: 启动打包的 VS Code

```bash
# 在项目根目录执行
./scripts/code.sh
```

等待 VS Code 窗口打开。

### 步骤 2: 打开 AionUI 窗口

1. 按 `Cmd+Shift+P` 打开命令面板
2. 输入 `aionui`
3. 选择 **"AionUI: Open Window"**

### 步骤 3: 查看 DevTools

AionUI 窗口打开后，DevTools 会自动打开。查看 **Console** 标签页。

### 步骤 4: 检查初始化日志

在 Console 中查找以下关键日志：

#### ✅ 成功的标志：

```
AionUIWindowManager - initializing AionUI backend system...
AionUIWindowManager - Set NODE_PATH: /path/to/out/aionui/node_modules
AionUIWindowManager - AionUI process module loaded: { hasInitializeProcess: true, ... }
AionUIWindowManager - calling initializeProcess()...
✅ AionUI backend initialized successfully
```

#### ❌ 失败的标志：

```
❌ Failed to initialize AionUI backend: Cannot find module '@sentry/electron/main'
⚠️ falling back to minimal data provider
```

### 步骤 5: 测试 IPC 通信

在 DevTools Console 中粘贴并运行：

```javascript
window.electronAPI.emit('subscribe-acp.get-available-agents', {id:'test-' + Date.now()})
  .then(result => {
    console.log('=== IPC Test Result ===');
    console.log('Success:', result?.success);
    console.log('Agent count:', result?.data?.length);
    console.log('Agents:', JSON.stringify(result?.data, null, 2));
  })
  .catch(error => {
    console.error('IPC Test Failed:', error);
  });
```

#### 预期结果：

**完整后端成功**:
```javascript
{
  success: true,
  data: [
    {
      backend: "gemini",
      name: "Gemini",
      supportedTransports: []
    }
    // 可能还有其他检测到的 CLI 工具
  ]
}
```

**回退模式**（当前）:
```javascript
{
  success: true,
  data: [
    {
      backend: "gemini",
      name: "Gemini",
      supportedTransports: []
    }
  ]
}
```

### 步骤 6: 检查界面

在 AionUI 窗口中确认：

- ✅ 能看到 Gemini 智能体
- ✅ 能看到 20 个预设助手（Word Creator, PPT Creator 等）
- ✅ 界面没有无限加载状态

## 详细诊断（如果出现问题）

### 诊断 1: 检查文件是否存在

在终端运行：

```bash
# 检查主文件
ls -lh out/aionui/dist/main/index.cjs

# 检查 node_modules
ls out/aionui/node_modules | wc -l

# 检查关键依赖
ls -d out/aionui/node_modules/@sentry/electron
ls -d out/aionui/node_modules/@office-ai/aioncli-core
```

### 诊断 2: 查看完整错误堆栈

如果看到错误，在 DevTools Console 中展开错误对象，查看完整的堆栈跟踪。

### 诊断 3: 检查 NODE_PATH

在 DevTools Console 中运行：

```javascript
// 这个无法直接访问，但可以从日志中看到
// 查找包含 "Set NODE_PATH" 的日志
```

### 诊断 4: 手动测试模块加载

在 VS Code 的主进程中（不是 AionUI 窗口），打开 Help → Toggle Developer Tools，然后在 Console 中运行：

```javascript
// 测试 NODE_PATH 是否生效
console.log('NODE_PATH:', process.env.NODE_PATH);

// 测试能否 require Sentry
try {
  const sentry = require('@sentry/electron/main');
  console.log('✅ Sentry loaded:', typeof sentry.init);
} catch (e) {
  console.error('❌ Sentry failed:', e.message);
}
```

## 测试结果判断

### 场景 A: 完整后端成功 🎉

**标志**:
- ✅ 日志显示 "AionUI backend initialized successfully"
- ✅ 没有 "Cannot find module" 错误
- ✅ 没有 "falling back" 警告
- ✅ IPC 测试成功返回数据

**下一步**:
1. 测试 CLI 工具检测（如果系统中安装了 acp、codex 等）
2. 测试用户自定义配置
3. 测试扩展系统

### 场景 B: 回退模式（当前状态）⚠️

**标志**:
- ⚠️ 日志显示 "falling back to minimal data provider"
- ⚠️ 有 "Cannot find module" 错误
- ✅ 界面仍然可用
- ✅ 显示默认的 Gemini 和 20 个助手

**原因可能**:
1. NODE_PATH 设置未生效
2. node_modules 未正确复制
3. 模块路径解析问题
4. Sentry 初始化失败

**下一步**:
1. 查看具体错误信息
2. 检查文件是否存在
3. 考虑其他解决方案

### 场景 C: 完全失败 ❌

**标志**:
- ❌ AionUI 窗口无法打开
- ❌ 或窗口打开但完全空白
- ❌ 或显示错误页面

**下一步**:
1. 查看 VS Code 主进程的 DevTools
2. 查看终端输出的错误
3. 检查构建是否完整

## 快速命令参考

```bash
# 重新构建（如果需要）
yarn gulp vscode-darwin-arm64-min

# 启动 VS Code
./scripts/code.sh

# 检查构建输出
ls -lh out/aionui/dist/main/index.cjs
ls out/aionui/node_modules | wc -l
```

## 报告结果

测试完成后，请告诉我：

1. **初始化状态**: 成功 / 回退模式 / 失败
2. **错误信息**: 如果有，复制完整的错误日志
3. **IPC 测试结果**: 返回的数据内容
4. **界面状态**: 能否看到智能体和助手

这样我可以根据具体情况提供进一步的解决方案。

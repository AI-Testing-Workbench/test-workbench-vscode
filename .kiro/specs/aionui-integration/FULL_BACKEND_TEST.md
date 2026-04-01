# AionUI 完整后端测试指南

## 当前状态

✅ **已完成的改进**:
1. 修改 Vite 配置，尝试使用 `ssr.noExternal: true` 来捆绑依赖
2. 添加 `copyNodeModules()` 函数，复制 1104 个运行时依赖包到输出目录
3. 在 `aionuiWindowManager.js` 中添加 `NODE_PATH` 设置，让 Node.js 能找到依赖
4. 排除了不必要的包（electron, vite, typescript 等开发依赖）

## 构建验证

```bash
# 检查构建输出
ls -lh out/aionui/dist/main/index.cjs
# 应该显示: 2.1M

# 检查 node_modules
ls out/aionui/node_modules | wc -l
# 应该显示: ~1122 个包

# 检查关键依赖
ls -d out/aionui/node_modules/@sentry/electron
ls -d out/aionui/node_modules/@office-ai/aioncli-core
ls -d out/aionui/node_modules/better-sqlite3
```

## 测试步骤

### 1. 启动打包的 VS Code

```bash
# 启动应用
./scripts/code.sh
```

### 2. 打开 AionUI 窗口

1. 按 `Cmd+Shift+P` 打开命令面板
2. 输入 "AionUI"
3. 选择 "AionUI: Open Window"

### 3. 检查 DevTools 日志

窗口打开后，DevTools 会自动打开。查看 Console 标签页中的日志：

#### 预期的成功日志：

```
AionUIWindowManager - initializing AionUI backend system...
AionUIWindowManager - AionUI main process path: { ... exists: true }
AionUIWindowManager - Set NODE_PATH: /path/to/out/aionui/node_modules
AionUIWindowManager - AionUI process module loaded: { hasInitializeProcess: true, exports: [...] }
AionUIWindowManager - calling initializeProcess()...
AionUIWindowManager - ✅ AionUI backend initialized successfully
```

#### 如果看到错误：

```
❌ Failed to initialize AionUI backend: Cannot find module '@sentry/electron/main'
```

这意味着 NODE_PATH 设置没有生效，或者依赖没有正确复制。

### 4. 测试 IPC 通信

在 DevTools Console 中运行：

```javascript
// 测试智能体获取
window.electronAPI.emit('subscribe-acp.get-available-agents', {id:'test'})
  .then(r => console.log('✅ Agents:', r))
  .catch(e => console.error('❌ Error:', e));
```

#### 预期结果（完整后端）：

```javascript
{
  success: true,
  data: [
    { backend: 'gemini', name: 'Gemini', cliPath: undefined, supportedTransports: [] },
    // 可能还有其他检测到的 CLI 工具（如果系统中安装了 acp、codex 等）
  ]
}
```

#### 当前结果（回退模式）：

```javascript
{
  success: true,
  data: [
    { backend: 'gemini', name: 'Gemini', supportedTransports: [] }
  ]
}
```

### 5. 检查助手列表

在 AionUI 界面中：

1. 应该看到 Gemini 智能体
2. 应该看到 20 个预设助手（Word Creator, PPT Creator 等）

## 故障排查

### 问题 1: "Cannot find module '@sentry/electron/main'"

**原因**: NODE_PATH 未正确设置或依赖未复制

**解决方案**:
1. 检查 `out/aionui/node_modules/@sentry/electron` 是否存在
2. 检查 `aionuiWindowManager.js` 中的 NODE_PATH 设置代码
3. 重新构建: `yarn gulp vscode-darwin-arm64-min`

### 问题 2: "initializeProcess is not a function"

**原因**: AionUI 模块导出不正确

**解决方案**:
1. 检查 `extensions/aionui-main/src/index.ts` 是否导出了 `initializeProcess`
2. 重新构建 AionUI: `cd extensions/aionui-main && bun run package`
3. 重新构建 VS Code

### 问题 3: 界面显示但没有智能体

**原因**: 后端初始化失败，使用了回退模式

**解决方案**:
1. 查看 DevTools Console 中的错误日志
2. 检查是否有 "falling back to minimal data provider" 消息
3. 根据具体错误信息进行调试

## 成功标准

✅ **完整后端成功的标志**:

1. DevTools 显示 "✅ AionUI backend initialized successfully"
2. 没有 "Cannot find module" 错误
3. 没有 "falling back to minimal data provider" 警告
4. IPC 测试返回完整的智能体数据
5. 如果系统中安装了 CLI 工具，应该能检测到

## 当前限制

即使完整后端初始化成功，以下功能仍然受限：

- ❌ CLI 工具检测（需要 ACP Detector 完整运行）
- ❌ 用户自定义智能体配置
- ❌ 扩展贡献的智能体
- ✅ 预设助手（20 个内置助手）
- ✅ 基础 Gemini 智能体

## 下一步

如果完整后端初始化成功：
1. 测试 CLI 工具检测功能
2. 测试用户配置加载
3. 测试扩展系统集成
4. 优化加载性能

如果仍然失败：
1. 考虑使用当前的回退方案（默认数据）
2. 逐步启用后端功能
3. 添加更详细的错误日志

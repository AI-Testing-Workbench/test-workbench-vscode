# IPC 数据返回修复说明

## 问题描述

用户报告：
- UI 可以正常显示
- 可以看到 Gemini agent pill
- 但是点击"添加智能体"或"Create"没有任何反应
- DevTools 显示 IPC 返回 `true` 而不是实际数据

调试输出：
```javascript
5. ✅ IPC Result: treu
6. Success: undefined
7. Agent count: undefinde
```

## 根本原因

Fallback IPC handler 的实现有问题：

1. **旧代码**：直接返回 `minimalDataProvider.handleEvent()` 的结果
2. **问题**：没有正确处理请求数据中的 `id` 字段
3. **结果**：返回值被解析为布尔值 `true`，而不是实际的数据对象

## 修复方案

### 1. 更新 `setupFallbackIpcHandler()`

**修改前**：
```javascript
const { name, data, id } = JSON.parse(info);
this.logService.info(`MinimalDataProvider - handling event: ${name}`, ...);
```

**修改后**：
```javascript
const { name, data } = JSON.parse(info);
const requestId = data?.id;  // ID 在 data 对象中，不是顶层
this.logService.info(`FallbackHandler [${requestId}] - handling: ${name}`);
```

### 2. 改进日志输出

添加了更详细的日志：
- 显示请求 ID（如果有）
- 显示完整的响应数据（截断长响应）
- 使用统一的日志前缀 `FallbackHandler`

### 3. 确保数据格式正确

`createMinimalDataProvider()` 已经返回正确的格式：
```javascript
{
  success: true,
  data: [
    {
      backend: 'gemini',
      name: 'Gemini',
      supportedTransports: []
    }
  ]
}
```

## 测试步骤

### 1. 快速更新

```bash
./quick-copy-manager.sh
```

这个脚本只复制修改的文件，不需要重新构建。

### 2. 启动测试

```bash
./test-vscode-aionui.sh
```

### 3. 检查 DevTools

打开 AionUI 窗口后，DevTools 会自动打开。查看 Console：

**期望输出**：
```javascript
5. ✅ IPC Result: {success: true, data: Array(1)}
6. Success: true
7. Agent count: 1
   Agent 0: {"backend":"gemini","name":"Gemini","supportedTransports":[]}
```

### 4. 检查主进程日志

```bash
./.kiro/specs/aionui-integration/check-backend-logs.sh
```

**期望看到**：
```
FallbackHandler [debug-test-xxx] - handling: subscribe-acp.get-available-agents
FallbackHandler [debug-test-xxx] - ✅ returning Gemini agent: {"success":true,"data":[...]}
```

## 预期结果

修复后应该：
1. ✅ IPC 返回正确的数据对象
2. ✅ UI 可以看到 Gemini agent
3. ✅ 点击"Create"可以创建对话
4. ✅ 可以选择 Gemini 作为智能体

## 如果还有问题

### 问题 1：仍然返回 true

**可能原因**：文件没有正确复制

**解决方案**：
```bash
# 验证文件是否更新
ls -la "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/aionui/electron-main/aionuiWindowManager.js"

# 如果时间戳不对，手动复制
cp src/vs/aionui/electron-main/aionuiWindowManager.js "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/aionui/electron-main/aionuiWindowManager.js"
```

### 问题 2：没有日志输出

**可能原因**：使用了完整的 AionUI backend 而不是 fallback

**解决方案**：这是好事！说明完整的 backend 初始化成功了。检查是否有其他错误。

### 问题 3：UI 功能仍然不工作

**可能原因**：需要其他 IPC 端点

**解决方案**：
1. 查看 DevTools Console 的错误
2. 查看主进程日志中的 IPC 请求
3. 在 `createMinimalDataProvider()` 中添加对应的处理

## 相关文件

- `src/vs/aionui/electron-main/aionuiWindowManager.js` - 主要修改
- `quick-copy-manager.sh` - 快速更新脚本
- `测试UI功能.md` - 测试指南

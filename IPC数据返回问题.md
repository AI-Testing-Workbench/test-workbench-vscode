# IPC 数据返回问题

## 问题描述

UI 无法获取后端数据，所有操作（添加智能体、创建对话等）都没有响应。

### 根本原因

AionUI 的 IPC handler 返回了 `emitter.emit()` 的结果（布尔值），而不是实际的数据：

```typescript
// ❌ 错误：返回布尔值
ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, (_event, info) => {
  const { name, data } = JSON.parse(info);
  return Promise.resolve(emitter.emit(name, data)); // 返回 true/false
});
```

### 预期行为

IPC handler 应该返回 provider 的实际数据：

```typescript
// ✅ 正确：返回实际数据
ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, async (_event, info) => {
  const { name, data } = JSON.parse(info);
  // 等待 provider 响应并返回数据
  return await waitForProviderResponse(name, data);
});
```

## 当前尝试的解决方案

修改了 `extensions/aionui-main/src/common/adapter/main.ts`，尝试监听响应事件：

```typescript
return new Promise((resolve) => {
  const responseHandler = (responseData) => {
    resolve(responseData);
  };

  emitter.once(name, responseHandler);
  emitter.emit(name, data);

  setTimeout(() => {
    emitter.off(name, responseHandler);
    resolve(undefined);
  }, 5000);
});
```

### 问题

这个方案可能不正确，因为：
1. `@office-ai/platform` 的 bridge 系统可能不是通过相同事件名返回数据
2. Provider 的响应机制可能是通过其他方式（如回调或 Promise）

## 测试步骤

1. 重启 VS Code
2. 打开 AionUI
3. 尝试添加智能体或创建对话
4. 检查 DevTools Console 是否有新的日志或错误
5. 检查主进程日志中的 IPC 调用

```bash
# 查看最新日志
./.kiro/specs/aionui-integration/check-backend-logs.sh
```

## 可能的解决方案

### 方案 1：研究 @office-ai/platform 的 bridge 实现

需要理解 `buildProvider` 和 `buildConsumer` 的工作机制，找到正确的数据返回方式。

### 方案 2：使用 fallback handler

如果无法修复真正的 IPC handler，可以继续使用 fallback handler，它可以正常返回数据。

缺点：功能有限，只提供基本数据。

### 方案 3：修改 bridge 系统

可能需要修改 AionUI 的 bridge adapter 来支持 Electron IPC 的同步返回模式。

## 下一步

1. **测试当前修改**：看看监听响应事件的方案是否有效
2. **查看日志**：检查是否有新的错误或提示
3. **研究源码**：深入理解 `@office-ai/platform` 的 bridge 机制
4. **考虑替代方案**：如果修复太复杂，可能需要重新设计 IPC 通信方式

## 相关文件

- `extensions/aionui-main/src/common/adapter/main.ts` - IPC handler
- `extensions/aionui-main/src/common/adapter/browser.ts` - Browser adapter
- `extensions/aionui-main/src/preload.ts` - Preload script
- `src/vs/aionui/electron-main/aionuiWindowManager.js` - Fallback handler

# 🎯 最终测试 - IPC 处理器重复注册已修复

## 修复说明

修改了 `extensions/aionui-main/src/common/adapter/main.ts`，在注册 IPC 处理器时添加了 try-catch：

```typescript
try {
  ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, (_event, info) => {
    const { name, data } = JSON.parse(info) as BridgeEventData;
    return Promise.resolve(emitter.emit(name, data));
  });
  console.log('[AionUI] IPC handler registered successfully');
} catch (error) {
  if (error instanceof Error && error.message.includes('second handler')) {
    console.log('[AionUI] IPC handler already registered, reusing existing handler');
  } else {
    throw error;
  }
}
```

这样，如果处理器已经存在（比如第二次打开窗口时），会捕获错误并继续执行，而不是抛出异常。

## 测试步骤

### 1. 完全退出 VS Code

确保没有 VS Code 进程在运行：

```bash
pkill -9 "Code - OSS"
```

### 2. 启动应用

```bash
~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/MacOS/Code\ -\ OSS
```

### 3. 第一次打开 AionUI

1. 按 `Cmd+Shift+P`
2. 输入 "Open AionUI"
3. 按回车

**预期结果：**
- ✅ 窗口成功打开
- ✅ 显示 AionUI 界面
- ✅ 控制台显示：`[AionUI] IPC handler registered successfully`
- ✅ 至少显示一个 agent（Gemini）

### 4. 关闭 AionUI 窗口

点击 AionUI 窗口的关闭按钮（不要退出 VS Code）

### 5. 第二次打开 AionUI

1. 按 `Cmd+Shift+P`
2. 输入 "Open AionUI"
3. 按回车

**预期结果：**
- ✅ 窗口成功打开
- ✅ 显示 AionUI 界面
- ✅ 控制台显示：`[AionUI] IPC handler already registered, reusing existing handler`
- ❌ **不应该**出现 "Attempted to register a second handler" 错误

### 6. 测试功能

在 AionUI 窗口中：
1. 确认可以看到 Gemini agent
2. 输入一条测试消息（例如："Hello"）
3. 查看是否有回复

## 成功标志

### 控制台日志（第一次打开）

```
[AionUI] Running in VS Code integration mode, using native console
[AionUI] IPC handler registered successfully
[main] AionUIWindowManager - ✅ AionUI backend initialized successfully
```

### 控制台日志（第二次打开）

```
[AionUI] Running in VS Code integration mode, using native console
[AionUI] IPC handler already registered, reusing existing handler
[main] AionUIWindowManager - IPC handler already registered, skipping backend initialization
```

### 不应该看到的错误

```
❌ Attempted to register a second handler for 'office-ai-bridge-adapter'
```

## 查看日志

### 方式 1：开发者工具（推荐）

1. 在 VS Code 主窗口中按 `Cmd+Option+I` 打开开发者工具
2. 切换到 Console 标签
3. 过滤 "AionUI" 查看相关日志

### 方式 2：AionUI 窗口的开发者工具

1. 在 AionUI 窗口中按 `Cmd+Option+I`
2. 查看 Console 标签
3. 查找 IPC 相关的日志

## 故障排除

### 问题：仍然出现 "second handler" 错误

**可能原因：**
- 旧的构建缓存
- VS Code 进程没有完全退出

**解决方案：**
1. 完全退出 VS Code
2. 清理构建缓存：
   ```bash
   rm -rf out/aionui
   rm -rf out-vscode-min/aionui
   ```
3. 重新构建：
   ```bash
   yarn gulp build-aionui
   yarn gulp vscode-darwin-arm64-min
   ```

### 问题：窗口打开但是空白

**可能原因：**
- 前端资源加载失败
- IPC 通信失败

**解决方案：**
1. 打开 AionUI 窗口的开发者工具
2. 查看 Console 中的错误
3. 查看 Network 标签，确认资源加载状态

### 问题：无法发送消息

**可能原因：**
- IPC 处理器未正确注册
- 后端初始化失败

**解决方案：**
1. 在开发者工具 Console 中测试 IPC：
   ```javascript
   window.electronAPI.emit('subscribe-acp.get-available-agents', { id: 'test' })
     .then(result => console.log('IPC test result:', result))
     .catch(error => console.error('IPC test error:', error))
   ```
2. 查看返回结果是否正常

## 验证清单

- [ ] 第一次打开窗口成功
- [ ] 第二次打开窗口成功
- [ ] 没有 "second handler" 错误
- [ ] UI 正常显示
- [ ] 可以看到 Gemini agent
- [ ] 可以发送消息（可选，取决于 Gemini API 配置）

## 下一步

如果所有测试通过：
- ✅ **集成完全成功！**
- 📝 更新文档
- 🎉 开始正常使用 AionUI

如果测试失败：
- 📋 记录详细的错误信息
- 🔍 查看完整的日志
- 💬 提供反馈以便进一步调试

## 技术细节

### 为什么会出现重复注册？

1. **第一次打开窗口**：
   - AionUI 的 `index.cjs` 被加载
   - `bridge.adapter()` 被调用
   - IPC 处理器被注册

2. **关闭窗口**：
   - 窗口被销毁
   - 但 IPC 处理器仍然存在（全局的）

3. **第二次打开窗口**：
   - AionUI 的 `index.cjs` 再次被加载（或使用缓存）
   - `bridge.adapter()` 再次被调用
   - 尝试注册 IPC 处理器
   - **错误**：处理器已存在

### 修复方案

在注册处理器时捕获 "second handler" 错误，如果是这个错误就忽略它，继续使用现有的处理器。这样既保证了第一次能正常注册，也保证了第二次不会因为重复注册而失败。

---

**最后更新**: 2026-03-31 12:44

**状态**: 🟢 准备测试

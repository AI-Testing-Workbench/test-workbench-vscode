# IPC 数据返回修复完成 ✅

## 问题根源

`@office-ai/platform` 的 bridge 系统使用回调模式，而不是直接返回值：

1. Consumer 发送 `subscribe-{name}` 事件，带有唯一 ID：`{id: 'xxx', data: {...}}`
2. Provider 处理后发送 `subscribe.callback-{name}{id}` 事件返回数据
3. Consumer 监听回调事件并 resolve Promise

## 修复方案

修改了 `extensions/aionui-main/src/common/adapter/main.ts` 中的 IPC handler：

```typescript
ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, async (_event, info) => {
  const { name, data } = JSON.parse(info);
  const requestId = data?.id;

  if (!requestId) {
    emitter.emit(name, data);
    return undefined;
  }

  return new Promise((resolve, reject) => {
    // 监听回调事件：subscribe.callback-{name}{id}
    const callbackEventName = `subscribe.callback-${name.replace('subscribe-', '')}${requestId}`;
    const timeout = setTimeout(() => {
      emitter.off(callbackEventName, callbackHandler);
      reject(new Error(`Timeout for ${name}`));
    }, 10000);

    const callbackHandler = (responseData) => {
      clearTimeout(timeout);
      resolve(responseData);
    };

    emitter.once(callbackEventName, callbackHandler);
    emitter.emit(name, data);
  });
});
```

## 测试步骤

1. 重启 VS Code：
   ```bash
   # 关闭 VS Code，然后
   ./test-vscode-aionui.sh
   ```

2. 打开 AionUI 窗口

3. 测试功能：
   - 添加智能体
   - 创建对话
   - 发送消息

4. 检查 DevTools Console：
   - 应该看到：`5c. Result JSON: {"success":true,"data":[...]}`
   - 应该看到：`7. Agent count: 1` (或更多)

## 预期结果

- ✅ IPC 调用返回正确的数据对象
- ✅ UI 可以获取后端数据
- ✅ 所有功能正常工作

## 如果还有问题

查看日志：
```bash
./.kiro/specs/aionui-integration/check-backend-logs.sh
```

查找：
- IPC 调用日志
- 回调事件日志
- 超时错误

## 技术细节

### Bridge 回调模式

```
Consumer (Renderer)                Provider (Main)
      |                                   |
      | subscribe-acp.get-available-agents
      | {id: 'xxx', data: {}}
      |---------------------------------->|
      |                                   | 处理请求
      |                                   | 获取数据
      |                                   |
      | subscribe.callback-acp.get-available-agentsxxx
      | {success: true, data: [...]}
      |<----------------------------------|
      |                                   |
   resolve(data)
```

### 事件名称格式

- 请求：`subscribe-{bridgeName}`
- 回调：`subscribe.callback-{bridgeName}{requestId}`

例如：
- 请求：`subscribe-acp.get-available-agents`
- 回调：`subscribe.callback-acp.get-available-agentsdebug-test-1234567890`

## 相关文件

- `extensions/aionui-main/src/common/adapter/main.ts` - IPC handler（已修复）
- `extensions/aionui-main/node_modules/@office-ai/platform/dist/index.js` - Bridge 实现
- `src/vs/aionui/electron-main/aionuiWindowManager.js` - 调试脚本（已增强）

# AionUI 加载问题诊断

## 问题描述
打包后的 VS Code 启动 AionUI 时，界面一直显示"加载中"（骨架屏），无法显示智能体列表和助手列表。

## 根本原因分析

### 1. 前端加载逻辑
在 `GuidPage.tsx` 中：
```typescript
{agentSelection.availableAgents === undefined ? (
  <AgentPillBarSkeleton />  // 显示骨架屏
) : (
  <AgentPillBar ... />      // 显示实际内容
)}
```

当 `availableAgents === undefined` 时，页面显示骨架屏（loading 状态）。

### 2. 数据获取流程
在 `useGuidAgentSelection.ts` 中：
```typescript
const { data: availableAgentsData } = useSWR('acp.agents.available', async () => {
  const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
  if (result.success) {
    return result.data.filter((agent) => !(agent.backend === 'gemini' && agent.cliPath));
  }
  return [];
});
```

SWR 会一直等待 `ipcBridge.acpConversation.getAvailableAgents.invoke()` 返回数据。

### 3. IPC 通信问题
可能的问题：
1. IPC handler 没有正确注册
2. IPC 调用超时或失败
3. 返回数据格式不正确
4. SWR 没有正确处理错误

## 解决方案

### 方案 1：添加 SWR 错误处理和超时
修改 `useGuidAgentSelection.ts`，添加错误处理：

```typescript
const { data: availableAgentsData, error } = useSWR(
  'acp.agents.available',
  async () => {
    try {
      const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
      if (result.success) {
        return result.data.filter((agent) => !(agent.backend === 'gemini' && agent.cliPath));
      }
      return [];
    } catch (error) {
      console.error('Failed to load agents:', error);
      // 返回默认的 Gemini agent
      return [{
        backend: 'gemini',
        name: 'Gemini',
        supportedTransports: []
      }];
    }
  },
  {
    // 添加超时和重试配置
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    dedupingInterval: 2000,
    // 如果失败，使用 fallback 数据
    fallbackData: [{
      backend: 'gemini',
      name: 'Gemini',
      supportedTransports: []
    }]
  }
);
```

### 方案 2：修改 IPC Bridge 添加超时
在 `ipcBridge.ts` 或相关文件中，为 IPC 调用添加超时：

```typescript
async function invokeWithTimeout(channel, data, timeout = 5000) {
  return Promise.race([
    ipcBridge.invoke(channel, data),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IPC timeout')), timeout)
    )
  ]);
}
```

### 方案 3：在前端添加初始数据（推荐）
修改 `useGuidAgentSelection.ts`，提供初始数据：

```typescript
const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([
  // 提供默认的 Gemini agent，避免 undefined 状态
  {
    backend: 'gemini',
    name: 'Gemini',
    supportedTransports: []
  }
]);

const { data: availableAgentsData } = useSWR('acp.agents.available', async () => {
  const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
  if (result.success) {
    return result.data.filter((agent) => !(agent.backend === 'gemini' && agent.cliPath));
  }
  return [];
});

useEffect(() => {
  if (availableAgentsData) {
    setAvailableAgents(availableAgentsData);
  }
}, [availableAgentsData]);
```

### 方案 4：检查 IPC Handler 注册时机
确保 IPC handler 在窗口创建之前就已经注册：

在 `aionuiWindowManager.js` 的 `launchAionUI` 方法中：
```javascript
async launchAionUI(electron) {
  // 1. 先注册 IPC handler
  await this.setupFallbackIpcHandler(electron);

  // 2. 再创建窗口
  const aionuiWindow = new electron.BrowserWindow({...});

  // 3. 加载页面
  await aionuiWindow.loadURL(...);
}
```

## 推荐实施步骤

1. **立即修复**：实施方案 3，在前端提供初始数据
2. **增强健壮性**：实施方案 1，添加错误处理和 fallback
3. **长期优化**：实施方案 4，确保 IPC 注册时机正确

## 测试验证

修改后，在浏览器 DevTools Console 中运行：
```javascript
// 测试 IPC 是否工作
window.electronAPI.emit('subscribe-acp.get-available-agents', {id:'test'})
  .then(r => console.log('✅ IPC works:', r))
  .catch(e => console.error('❌ IPC failed:', e));

// 检查 React 状态
// 在 GuidPage 组件中添加 console.log
console.log('availableAgents:', agentSelection.availableAgents);
```

## 相关文件
- `extensions/aionui-main/src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`
- `extensions/aionui-main/src/renderer/pages/guid/GuidPage.tsx`
- `src/vs/aionui/electron-main/aionuiWindowManager.js`
- `extensions/aionui-main/src/common/adapter/ipcBridge.ts`

# 测试打包后的 VS Code

## 测试命令
```bash
~/VSCode-darwin-arm64/"Code - OSS.app"/Contents/MacOS/"Code - OSS" --aionui
```

## 预期结果

### 1. 界面应该立即显示
- ✅ 不再显示骨架屏（loading 状态）
- ✅ 显示 Gemini 智能体卡片
- ✅ 显示 20 个预设助手

### 2. 控制台日志
打开 DevTools (Cmd+Option+I)，应该看到：
```
MinimalDataProvider - handling event: subscribe-acp.get-available-agents
MinimalDataProvider - response for subscribe-acp.get-available-agents
```

### 3. 测试 IPC 通信
在 DevTools Console 中运行：
```javascript
window.electronAPI.emit('subscribe-acp.get-available-agents', {id:'test'})
  .then(r => console.log('✅ Result:', r))
  .catch(e => console.error('❌ Error:', e));
```

应该返回：
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

## 修复内容

### 前端修改
文件: `extensions/aionui-main/src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`

修改前：
```typescript
const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>();
```

修改后：
```typescript
// test-workbench_change: Provide default Gemini agent to avoid undefined state
const [availableAgents, setAvailableAgents] = useState<AvailableAgent[] | undefined>([
  {
    backend: 'gemini',
    name: 'Gemini',
    supportedTransports: []
  }
]);
```

### 后端修改
文件: `src/vs/aionui/electron-main/aionuiWindowManager.js`

增强了日志记录，添加了更详细的 IPC 事件跟踪。

## 工作原理

1. **初始状态**：前端现在有一个默认的 Gemini agent，不再是 `undefined`
2. **避免骨架屏**：因为 `availableAgents` 不是 `undefined`，页面立即渲染内容
3. **后台更新**：SWR 在后台获取真实数据，获取成功后更新状态
4. **用户体验**：用户立即看到可用的智能体，无需等待加载

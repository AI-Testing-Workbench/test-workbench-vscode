# AionUI 智能体显示调试指南

## 当前状态

已成功实现：
- ✅ IPC 桥接正常工作
- ✅ 返回正确格式的数据：`{ success: true, data: [...] }`
- ✅ 数据包含正确的字段：`backend`, `name`, `isPreset`, `cliPath`, `context`, `avatar`
- ✅ 返回了两个模拟智能体：Claude Code 和 Qwen Code

## 返回的数据格式

```json
{
  "success": true,
  "data": [
    {
      "backend": "claude",
      "name": "Claude Code",
      "isPreset": true,
      "cliPath": "/usr/local/bin/claude",
      "context": "AI coding assistant",
      "avatar": "🤖"
    },
    {
      "backend": "qwen",
      "name": "Qwen Code",
      "isPreset": true,
      "cliPath": "npx @qwen-code/qwen-code",
      "context": "Qwen AI assistant",
      "avatar": "🔮"
    }
  ]
}
```

## 调试步骤

### 1. 检查 DevTools 控制台

AionUI 窗口应该已经自动打开了 DevTools。请检查：

1. **Console 标签页**
   - 查找任何 JavaScript 错误
   - 查找关于 agents 或数据加载的消息
   - 查找 SWR 缓存相关的消息

2. **Network 标签页**
   - 虽然这是 IPC 通信，但可能有相关的日志

3. **React DevTools**（如果安装了）
   - 检查组件状态
   - 查看 `useConversationAgents` hook 的状态
   - 查看 `useGuidAgentSelection` hook 的状态

### 2. 检查 UI 页面

智能体图标可能在以下位置显示：

1. **主页/引导页 (Guid Page)**
   - 文件：`extensions/aionui-main/src/renderer/pages/guid/`
   - 应该显示可用的智能体列表

2. **对话页面 (Conversation Page)**
   - 文件：`extensions/aionui-main/src/renderer/pages/conversation/`
   - 可能在侧边栏或顶部显示智能体选择器

3. **设置页面 (Settings Page)**
   - 文件：`extensions/aionui-main/src/renderer/pages/settings/AgentSettings/`
   - 应该显示本地智能体列表

### 3. 可能的问题

#### 问题 1：UI 过滤掉了模拟数据

查看 `filterAvailableAgentsForUi` 函数（在 `useConversationAgents.ts` 中）：

```typescript
const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
if (result.success) {
  return filterAvailableAgentsForUi(result.data);
}
```

这个过滤函数可能会过滤掉我们的模拟数据。

**解决方案**：检查过滤逻辑，确保模拟数据不会被过滤掉。

#### 问题 2：需要额外的健康检查

UI 可能会调用 `acp.check-agent-health` 来验证智能体是否可用：

```typescript
checkAgentHealth: bridge.buildProvider<
  IBridgeResponse<{ available: boolean; latency?: number; error?: string }>,
  { backend: AcpBackend }
>('acp.check-agent-health')
```

**解决方案**：在 MinimalDataProvider 中添加健康检查的处理。

#### 问题 3：需要 CLI 路径检测

UI 可能会调用 `acp.detect-cli-path` 来验证 CLI 是否存在：

```typescript
detectCliPath: bridge.buildProvider<
  IBridgeResponse<{ cliPath: string | null }>,
  { backend: AcpBackend }
>('acp.detect-cli-path')
```

**解决方案**：在 MinimalDataProvider 中添加 CLI 路径检测的处理。

### 4. 添加更多日志

在 MinimalDataProvider 中添加更详细的日志，查看 UI 实际请求了哪些事件：

```javascript
async handleEvent(name, data) {
  logService.info(`MinimalDataProvider - event: ${name}`, data ? JSON.stringify(data) : 'no data');

  // ... 处理逻辑 ...

  logService.info(`MinimalDataProvider - response for ${name}:`, JSON.stringify(result));
  return result;
}
```

### 5. 检查 SWR 缓存

UI 使用 SWR 进行数据缓存。可能需要：

1. 刷新页面（Cmd+R）
2. 清除缓存并刷新（Cmd+Shift+R）
3. 重启 AionUI 窗口

### 6. 手动测试步骤

1. **打开 AionUI 窗口**
   ```bash
   "../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui --verbose
   ```

2. **打开 DevTools**（应该自动打开）

3. **在 Console 中运行**：
   ```javascript
   // 检查 IPC bridge 是否可用
   window.ipcBridge

   // 手动调用 getAvailableAgents
   await window.ipcBridge.acpConversation.getAvailableAgents.invoke()
   ```

4. **查看返回的数据**
   - 应该看到 `{ success: true, data: [...] }`
   - 数据应该包含 Claude Code 和 Qwen Code

### 7. 可能需要的额外事件处理

根据代码分析，可能还需要处理以下事件：

```javascript
// 健康检查
'subscribe-acp.check-agent-health' -> { success: true, data: { available: true } }

// CLI 路径检测
'subscribe-acp.detect-cli-path' -> { success: true, data: { cliPath: '/usr/local/bin/claude' } }

// 环境检查
'subscribe-acp.check.env' -> { success: true }

// 刷新自定义智能体
'subscribe-acp.refresh-custom-agents' -> { success: true }
```

## 下一步行动

1. **立即检查**：打开 AionUI 窗口，查看 DevTools Console
2. **运行手动测试**：在 Console 中运行上面的测试代码
3. **查看日志**：检查 `test-final-fix.log` 中是否有其他相关事件
4. **报告结果**：告诉我你在 Console 中看到了什么

## 快速测试命令

```bash
# 查看所有 bridge 事件
grep "bridge event received" test-final-fix.log | cut -d':' -f4 | sort | uniq

# 查看所有 MinimalDataProvider 处理的事件
grep "MinimalDataProvider - handling event" test-final-fix.log | cut -d':' -f4 | sort | uniq

# 查看是否有错误
grep -i "error\|failed" test-final-fix.log | grep -v "Autofill\|Sentry"
```

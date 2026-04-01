# AionUI 集成状态报告

## 日期
2026-03-29

## 当前状态：✅ 基础集成完成

### 已完成的工作

1. **IPC 桥接系统** ✅
   - 成功注册 `office-ai-bridge-adapter` IPC 处理器
   - 所有事件正确路由到 MinimalDataProvider
   - 事件处理正常工作

2. **最小化数据提供者** ✅
   - 实现了 `createMinimalDataProvider()` 方法
   - 处理 11+ 种不同的事件类型
   - 返回正确格式的数据（`IBridgeResponse`）

3. **构建系统修复** ✅
   - 修复了 `build/gulpfile.aionui.js`
   - 集成文件正确复制到 `out-vscode` 和 `out-vscode-min`
   - 生产构建正常工作

4. **数据格式修复** ✅
   - ACP agents 数据使用正确的字段结构
   - 返回格式：`{ success: true, data: [...] }`
   - 包含必需字段：`backend`, `name`, `isPreset`, `cliPath`, `context`, `avatar`

### 当前返回的模拟数据

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

### 处理的事件统计

从最新测试日志：
- `subscribe-agent.config.storage.get`: 18 次
- `subscribe-acp.get-available-agents`: 2 次
- `subscribe-mode.get-model-config`: 2 次
- `subscribe-cron.list-jobs`: 2 次
- 其他事件各 1 次

## 智能体图标未显示的可能原因

### 1. UI 过滤逻辑

UI 可能会过滤掉某些智能体。查看 `filterAvailableAgentsForUi` 函数：

```typescript
// extensions/aionui-main/src/renderer/pages/conversation/hooks/useConversationAgents.ts
return filterAvailableAgentsForUi(result.data);
```

**建议**：在 DevTools Console 中检查过滤后的结果。

### 2. 健康检查失败

UI 可能会调用 `acp.check-agent-health` 来验证智能体：

```typescript
checkAgentHealth: bridge.buildProvider<
  IBridgeResponse<{ available: boolean; latency?: number; error?: string }>,
  { backend: AcpBackend }
>('acp.check-agent-health')
```

**当前状态**：未实现此事件处理
**建议**：添加健康检查处理，返回 `{ success: true, data: { available: true } }`

### 3. CLI 路径验证

UI 可能会验证 CLI 路径是否存在：

```typescript
detectCliPath: bridge.buildProvider<
  IBridgeResponse<{ cliPath: string | null }>,
  { backend: AcpBackend }
>('acp.detect-cli-path')
```

**当前状态**：未实现此事件处理
**建议**：添加 CLI 路径检测处理

### 4. UI 页面位置

智能体图标可能只在特定页面显示：

- **主页/引导页** (`/guid`)：应该显示智能体选择器
- **对话页面** (`/conversation`)：可能在侧边栏显示
- **设置页面** (`/settings/agents`)：应该显示智能体列表

**建议**：导航到不同的页面查看。

### 5. SWR 缓存问题

UI 使用 SWR 进行数据缓存，可能需要：

- 刷新页面（Cmd+R）
- 清除缓存并刷新（Cmd+Shift+R）
- 重启 AionUI 窗口

## 调试步骤

### 1. 打开 DevTools Console

AionUI 窗口应该已经自动打开 DevTools。在 Console 中运行：

```javascript
// 检查 IPC bridge
window.ipcBridge

// 手动获取智能体
await window.ipcBridge.acpConversation.getAvailableAgents.invoke()

// 检查 SWR 缓存
// 如果使用了 SWR DevTools，可以查看缓存状态
```

### 2. 查看 React 组件状态

如果安装了 React DevTools：

1. 找到 `useConversationAgents` hook
2. 查看 `availableAgentsData` 的值
3. 检查是否有过滤逻辑

### 3. 检查网络/IPC 通信

虽然是 IPC 通信，但可以在 Console 中看到相关日志。

### 4. 查看主进程日志

```bash
# 查看所有事件
grep "MinimalDataProvider" test-final-fix.log

# 查看返回的数据
grep "returning mock ACP agents" test-final-fix.log
```

## 下一步建议

### 立即行动

1. **检查 DevTools Console**
   - 查找 JavaScript 错误
   - 运行手动测试代码
   - 查看数据是否正确接收

2. **导航到不同页面**
   - 尝试访问主页
   - 尝试访问设置页面
   - 尝试创建新对话

3. **刷新页面**
   - 清除缓存并刷新
   - 重启 AionUI 窗口

### 如果仍然不显示

添加以下事件处理到 MinimalDataProvider：

```javascript
// 健康检查
if (name === 'subscribe-acp.check-agent-health') {
  return {
    success: true,
    data: { available: true, latency: 100 }
  };
}

// CLI 路径检测
if (name === 'subscribe-acp.detect-cli-path') {
  const backend = data?.backend;
  const cliPaths = {
    'claude': '/usr/local/bin/claude',
    'qwen': 'npx @qwen-code/qwen-code'
  };
  return {
    success: true,
    data: { cliPath: cliPaths[backend] || null }
  };
}

// 环境检查
if (name === 'subscribe-acp.check.env') {
  return { success: true };
}
```

## 测试命令

```bash
# 启动 AionUI
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui --verbose > test.log 2>&1 &

# 查看日志
tail -f test.log | grep -E "(MinimalDataProvider|bridge event|AionUI Console)"

# 查看事件统计
grep "bridge event received" test.log | grep -o "name: '[^']*'" | sort | uniq -c | sort -rn
```

## 文件位置

- 主实现：`src/vs/aionui/electron-main/aionuiWindowManager.js`
- 构建脚本：`build/gulpfile.aionui.js`
- 测试日志：`test-final-fix.log`
- 调试指南：`AIONUI_AGENT_DISPLAY_DEBUG.md`

## 结论

基础集成已经完成并正常工作。数据正在以正确的格式返回给 UI。如果智能体图标仍然不显示，最可能的原因是：

1. UI 的过滤逻辑过滤掉了模拟数据
2. 需要额外的健康检查或 CLI 路径验证
3. 智能体图标在不同的页面或视图中显示

请按照上面的调试步骤检查 DevTools Console，并告诉我你看到了什么。

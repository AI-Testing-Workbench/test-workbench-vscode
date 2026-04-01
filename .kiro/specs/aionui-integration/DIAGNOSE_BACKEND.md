# 🔍 诊断 AionUI 后端问题

## 症状

窗口可以打开，但后端服务不可用。

## 可能的原因

1. **后端初始化失败** - initializeProcess() 抛出异常
2. **IPC 通信失败** - 前端无法与后端通信
3. **Fallback 模式** - 使用了最小化数据提供者
4. **依赖缺失** - 某些运行时依赖未正确加载

## 诊断步骤

### 步骤 1：检查主进程日志

运行日志检查脚本：

```bash
.kiro/specs/aionui-integration/check-backend-logs.sh
```

**查找关键信息：**

1. **成功初始化**：
   ```
   ✅ AionUI backend initialized successfully
   ```

2. **Fallback 模式**：
   ```
   ⚠️ Falling back to minimal data provider
   ```

3. **初始化错误**：
   ```
   ❌ Failed to initialize AionUI backend: [错误信息]
   ```

### 步骤 2：在 AionUI 窗口中运行诊断脚本

1. 打开 AionUI 窗口
2. 按 `Cmd+Option+I` 打开开发者工具
3. 切换到 Console 标签
4. 复制并粘贴 `.kiro/specs/aionui-integration/diagnose-backend.js` 的内容
5. 按回车运行

**查看输出：**

- ✅ electronAPI 存在
- ✅ IPC 通信成功
- ✅ 后端响应成功
- Agent 数量和详情

### 步骤 3：手动测试 IPC

在 AionUI 窗口的 Console 中运行：

```javascript
// 测试获取 agents
window.electronAPI.emit('subscribe-acp.get-available-agents', { id: 'test-1' })
  .then(result => {
    console.log('✅ 成功:', result);
    console.log('Agent 数量:', result.data?.length);
    if (result.data) {
      result.data.forEach(agent => {
        console.log(`  - ${agent.name} (${agent.backend})`);
      });
    }
  })
  .catch(error => console.error('❌ 失败:', error));
```

### 步骤 4：检查网络请求

在 AionUI 窗口的开发者工具中：

1. 切换到 Network 标签
2. 刷新页面（Cmd+R）
3. 检查是否所有资源都成功加载
4. 查找失败的请求（红色）

## 常见问题和解决方案

### 问题 1：后端使用 Fallback 模式

**症状：**
```
⚠️ Falling back to minimal data provider
MinimalDataProvider - returning built-in Gemini agent
```

**原因：**
- `initializeProcess()` 抛出异常
- 依赖模块加载失败

**解决方案：**

1. 查看完整的错误日志：
   ```bash
   grep "Failed to initialize AionUI backend" ~/Library/Application\ Support/Code\ -\ OSS/logs/*/main.log
   ```

2. 检查是否缺少依赖：
   ```bash
   ls ~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/node_modules/ | wc -l
   ```
   应该有 1100+ 个包

3. 验证关键依赖：
   ```bash
   .kiro/specs/aionui-integration/verify-package.sh
   ```

### 问题 2：IPC 通信失败

**症状：**
```javascript
// Console 中运行测试返回错误
❌ IPC 通信失败: Error: ...
```

**原因：**
- IPC 处理器未注册
- preload 脚本未加载

**解决方案：**

1. 检查 preload 脚本是否存在：
   ```bash
   ls -la ~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/dist/preload/index.js
   ```

2. 在 Console 中检查：
   ```javascript
   console.log('electronAPI:', window.electronAPI);
   console.log('methods:', Object.keys(window.electronAPI || {}));
   ```

### 问题 3：只显示 Gemini，没有其他 agents

**症状：**
- UI 只显示一个 Gemini agent
- 没有检测到系统中的 CLI 工具

**原因：**
- ACP 检测未运行
- 系统中没有安装支持的 CLI 工具
- 使用了 Fallback 模式

**解决方案：**

1. **如果是 Fallback 模式**：
   - 修复后端初始化问题（见问题 1）

2. **如果后端正常但没有 CLI 工具**：
   - 这是正常行为
   - 安装支持的 CLI 工具（如 Claude CLI）
   - 重启应用

3. **检查 ACP 检测日志**：
   ```bash
   grep "ACP" ~/Library/Application\ Support/Code\ -\ OSS/logs/*/main.log | tail -20
   ```

### 问题 4：Cannot find module 错误

**症状：**
```
Cannot find module 'xxx'
```

**原因：**
- 依赖未正确复制
- NODE_PATH 未正确设置

**解决方案：**

1. 验证 node_modules：
   ```bash
   ls ~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/node_modules/[模块名]
   ```

2. 重新打包：
   ```bash
   yarn gulp build-aionui
   yarn gulp vscode-darwin-arm64-min
   ```

## 调试技巧

### 1. 启用详细日志

在启动应用时添加环境变量：

```bash
DEBUG=* ~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/MacOS/Code\ -\ OSS
```

### 2. 查看实时日志

```bash
tail -f ~/Library/Application\ Support/Code\ -\ OSS/logs/*/main.log | grep -i aionui
```

### 3. 检查进程状态

```bash
ps aux | grep "Code - OSS"
```

### 4. 清理缓存重试

```bash
# 完全退出应用
pkill -9 "Code - OSS"

# 清理缓存
rm -rf ~/Library/Application\ Support/Code\ -\ OSS/Cache
rm -rf ~/Library/Application\ Support/Code\ -\ OSS/CachedData

# 重新启动
~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/MacOS/Code\ -\ OSS
```

## 预期的正常状态

### 主进程日志

```
[main] AionUIWindowManager - Initializing AionUI backend system...
[main] AionUIWindowManager - Loading process module...
[main] AionUIWindowManager - Using CommonJS require
[AionUI] Running in VS Code integration mode, using native console
[AionUI] IPC handler registered successfully
[main] AionUIWindowManager - ✅ AionUI backend initialized successfully
```

### Console 输出（诊断脚本）

```
========================================
AionUI 后端诊断
========================================

1. 检查 electronAPI:
   ✅ electronAPI 存在
   可用方法: ['emit', 'on', 'off']

2. 测试 IPC 通信:
   ✅ IPC 通信成功
   ✅ 后端响应成功
   Agent 数量: 1
   Agents:
     1. Gemini (gemini)

3. 测试其他 IPC 方法:
   ✅ extensions.get-skills: []
   ✅ extensions.get-agents: []
   ✅ google.auth.status: { authenticated: true }

4. 检查 UI 状态:
   Agent pills 数量: 1
   Agents:
     1. backend=gemini, key=gemini, selected=true

5. 检查页面元素:
   ✅ React root 存在
   子元素数量: 1

========================================
诊断完成
========================================
```

## 下一步

根据诊断结果：

1. **如果后端正常初始化**：
   - ✅ 集成成功
   - 只显示 Gemini 是正常的（如果没有 CLI 工具）

2. **如果使用 Fallback 模式**：
   - 查看错误日志
   - 修复依赖问题
   - 重新打包

3. **如果 IPC 通信失败**：
   - 检查 preload 脚本
   - 检查 IPC 处理器注册
   - 查看详细错误信息

---

**提示**：请运行诊断脚本并提供输出结果，这样我可以帮你定位具体问题。

# 测试 AionUI 功能

## 最新修复（2026-04-01）

### 问题：IPC 返回 true 而不是数据

**症状**：
- UI 可以显示
- IPC 调用返回 `true`
- 但是 `result.success` 和 `result.data` 都是 `undefined`

**原因**：
Fallback IPC handler 直接返回了数据，但是没有正确处理 bridge 的请求格式。

**修复**：
1. 更新 `setupFallbackIpcHandler()` 来正确解析请求数据
2. 改进日志输出，显示请求 ID 和完整响应
3. 确保返回的数据格式正确：`{success: true, data: [...]}`

**测试**：
运行 `./quick-copy-manager.sh` 然后 `./test-vscode-aionui.sh`

## 当前状态

根据日志：
- ✅ 后端成功初始化
- ✅ 页面成功加载
- ✅ electronAPI 可用
- ✅ IPC 通信正常
- 🔧 修复了 IPC 数据返回问题

## 测试步骤

### 1. 检查 UI 是否显示

打开 AionUI 窗口，检查：
- [ ] 是否可以看到界面
- [ ] 是否可以看到 Gemini agent pill
- [ ] 是否有任何错误提示

### 2. 测试基本功能

尝试以下操作：

#### 添加智能体
1. 点击"添加智能体"或类似按钮
2. 查看是否有响应
3. 检查 DevTools Console 是否有错误

#### 创建对话
1. 尝试创建新对话
2. 查看是否成功
3. 检查是否可以选择 Gemini

#### 发送消息
1. 在对话中输入消息
2. 尝试发送
3. 查看是否有响应

### 3. 检查日志

如果功能不工作，检查：

#### VS Code 主进程日志
```bash
./.kiro/specs/aionui-integration/check-backend-logs.sh
```

查找：
- IPC 调用日志
- 错误信息
- Bridge 事件

#### AionUI DevTools Console
打开 AionUI 窗口的 DevTools，查看：
- Console 错误
- Network 请求
- IPC 调用结果

## 可能的问题

### 问题 1：IPC 返回 true 而不是数据

**症状**：UI 显示但功能不工作

**原因**：AionUI 的 IPC handler 返回 `emitter.emit()` 的结果（布尔值）

**解决方案**：需要修改 IPC handler 来正确返回数据

### 问题 2：Bridge 事件没有 provider

**症状**：某些功能不响应

**原因**：后端的 bridge provider 没有正确注册

**解决方案**：检查后端初始化日志，确认所有 bridge 都已注册

### 问题 3：数据库或存储问题

**症状**：无法保存数据

**原因**：better-sqlite3 或存储路径问题

**解决方案**：检查数据库文件路径和权限

## 下一步

根据测试结果：

1. **如果 UI 完全可用** ✅
   - 恭喜！所有问题都已解决
   - 可以正常使用 AionUI

2. **如果 UI 显示但功能不工作** ⚠️
   - 需要修复 IPC handler 的返回值
   - 或者检查 bridge provider 注册

3. **如果 UI 不显示或有严重错误** ❌
   - 检查 DevTools Console
   - 查看主进程日志
   - 可能需要进一步调试

# AionUI 功能对比：单独启动 vs VS Code 集成

## 错误消息说明

### ✅ 可以安全忽略的警告

#### 1. Sentry SDK 警告
```
Sentry SDK failed to establish connection with the Electron main process
```
- **原因：** 错误追踪服务未连接
- **影响：** 无，只是错误报告功能不可用
- **是否需要修复：** 否

#### 2. Autofill 警告
```
Request Autofill.enable failed
Request Autofill.setAddresses failed
```
- **原因：** Electron 版本不支持 Chrome Autofill API
- **影响：** 无，只是 DevTools 的自动填充不可用
- **是否需要修复：** 否

## 功能对比

### 单独启动模式（完整功能）

```bash
cd extensions/aionui-main
bun run start
```

**包含的服务：**
- ✅ 完整的主进程初始化
- ✅ 所有 IPC 处理器
- ✅ 完整的 Bridge Adapter（@office-ai/platform）
- ✅ WebSocket 服务器（远程访问）
- ✅ 自动更新服务
- ✅ 系统托盘
- ✅ 深度链接处理
- ✅ 所有后台服务（Cron、Worker 等）
- ✅ Sentry 错误追踪
- ✅ 完整的应用菜单

### VS Code 集成模式（简化版本）

```bash
code --aionui
```

**包含的服务：**
- ✅ 基本窗口创建
- ✅ 简化的 IPC 处理器（只处理基本通信）
- ⚠️ 简化的 Bridge Adapter（只确认消息）
- ❌ WebSocket 服务器
- ❌ 自动更新服务
- ❌ 系统托盘
- ❌ 深度链接处理
- ❌ 后台服务
- ❌ Sentry 错误追踪
- ❌ 应用菜单

## 功能可用性矩阵

| 功能分类 | 单独启动 | VS Code 集成 | 说明 |
|---------|---------|-------------|------|
| **基础 UI** |
| 窗口显示 | ✅ | ✅ | 完全支持 |
| 主题切换 | ✅ | ✅ | 完全支持 |
| 布局调整 | ✅ | ✅ | 完全支持 |
| **核心功能** |
| 聊天对话 | ✅ | ⚠️ | 需要测试 |
| 文件上传 | ✅ | ⚠️ | 需要测试 |
| 代码高亮 | ✅ | ✅ | 完全支持 |
| Markdown 渲染 | ✅ | ✅ | 完全支持 |
| **高级功能** |
| AI 模型切换 | ✅ | ⚠️ | 需要测试 |
| 技能管理 | ✅ | ⚠️ | 需要测试 |
| 设置保存 | ✅ | ⚠️ | 需要测试 |
| **系统集成** |
| 系统托盘 | ✅ | ❌ | 不支持 |
| 自动更新 | ✅ | ❌ | 不支持 |
| 深度链接 | ✅ | ❌ | 不支持 |
| **开发功能** |
| DevTools | ✅ | ✅ | 完全支持 |
| 热重载 | ✅ | ❌ | 不支持 |

## 可能不工作的功能

### 1. 需要完整 Bridge Adapter 的功能

**症状：** 功能调用后无响应或返回错误

**受影响的功能：**
- 复杂的 AI 模型交互
- 多窗口通信
- WebSocket 远程访问
- 某些高级设置

**原因：** 当前的 Bridge Adapter 是简化版本，只确认消息接收，不执行实际逻辑。

**解决方法：** 需要集成完整的 `@office-ai/platform` 库。

### 2. 需要后台服务的功能

**症状：** 定时任务不执行、后台处理不工作

**受影响的功能：**
- 定时任务（Cron jobs）
- 后台数据同步
- Worker 进程

**原因：** 后台服务未初始化。

**解决方法：** 需要初始化相应的服务。

### 3. 需要文件系统访问的功能

**症状：** 文件操作失败或权限错误

**受影响的功能：**
- 文件上传/下载
- 本地数据存储
- 配置文件读写

**原因：** 可能的路径或权限问题。

**解决方法：** 需要检查文件路径和权限配置。

## 测试清单

请测试以下功能并告诉我哪些不工作：

### 基础功能
- [ ] 窗口能正常显示
- [ ] 可以切换主题（亮色/暗色）
- [ ] 可以调整窗口大小
- [ ] 可以关闭窗口

### 聊天功能
- [ ] 可以输入消息
- [ ] 可以发送消息
- [ ] 可以接收回复
- [ ] 代码块正确显示
- [ ] Markdown 正确渲染

### 文件功能
- [ ] 可以上传文件
- [ ] 可以查看文件内容
- [ ] 可以下载文件

### 设置功能
- [ ] 可以打开设置页面
- [ ] 可以修改设置
- [ ] 设置能保存
- [ ] 重启后设置保持

### AI 功能
- [ ] 可以选择 AI 模型
- [ ] 可以切换模型
- [ ] 模型能正常响应
- [ ] 可以查看模型信息

## 调试步骤

### 1. 打开 DevTools Console

查看是否有除了 Sentry 和 Autofill 之外的错误。

### 2. 测试 IPC 通信

在 Console 中运行：
```javascript
// 测试基本通信
window.electronAPI.emit('test', { message: 'hello' })
  .then(result => console.log('✅ IPC 工作正常:', result))
  .catch(error => console.error('❌ IPC 错误:', error));
```

### 3. 检查 localStorage

在 Console 中运行：
```javascript
// 检查本地存储
console.log('localStorage keys:', Object.keys(localStorage));
console.log('localStorage data:', localStorage);
```

### 4. 测试具体功能

对于不工作的功能：
1. 在 Console 中查看错误消息
2. 在 Network 标签查看网络请求
3. 记录具体的操作步骤

## 获取帮助

如果某个功能不工作，请提供：

1. **功能名称** - 例如："文件上传"
2. **操作步骤** - 详细的点击步骤
3. **预期结果** - 应该发生什么
4. **实际结果** - 实际发生了什么
5. **Console 错误** - DevTools Console 中的错误消息
6. **Network 请求** - 如果有相关的网络请求失败

这样我就能帮你精确定位问题并提供解决方案！

## 快速测试脚本

```bash
# 启动并过滤无害警告
./start-aionui-clean.sh

# 或者直接启动
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui
```

然后在 DevTools Console 中运行测试命令，看看哪些功能不工作。

# Sentry 修复说明

## 问题原因

之前的修复尝试失败，因为：

1. **渲染进程无法访问 Node.js 环境变量**
   - 渲染进程运行在浏览器环境中
   - 无法直接访问 `process.env.VSCODE_AIONUI_INTEGRATION`
   - 导致 Sentry 仍然被初始化

2. **Sentry 代码已经打包进 JavaScript**
   - 构建后的代码在 `index-DQXhCJEQ.js` 中
   - 条件检查没有生效

## 解决方案

### 1. 通过 Preload 脚本暴露标志

修改 `extensions/aionui-main/src/preload.ts`：

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // 暴露 VS Code 集成标志
  isVSCodeIntegration: process.env.VSCODE_AIONUI_INTEGRATION === '1',
  // ... 其他 API
});
```

### 2. 在渲染进程中使用标志

修改 `extensions/aionui-main/src/renderer/main.tsx`：

```typescript
// 从 window.electronAPI 读取标志
const isVSCodeIntegration = window.electronAPI?.isVSCodeIntegration;

// 只在非 VS Code 集成模式下初始化 Sentry
if (!isVSCodeIntegration && window.electronAPI) {
  import('@sentry/electron/renderer').then((Sentry) => Sentry.init()).catch(() => {});
}
```

### 3. 重新构建并部署

```bash
# 1. 构建 AionUI
cd extensions/aionui-main
npm run package

# 2. 复制到 VS Code
cp -r out ../VSCode-darwin-arm64/.../out/aionui
```

## 验证步骤

1. 启动 VS Code
2. 打开 AionUI 窗口
3. 打开 DevTools
4. 在 Console 中搜索 "sentry-ipc"

**预期结果**：
- ✅ 不应该看到任何 sentry-ipc 错误
- ✅ 应该看到 "electronAPI exists: true"
- ✅ 应该看到 Gemini agent pill

## 技术细节

### Electron 安全模型

```
Main Process (Node.js)
  ↓ 设置环境变量
  ↓ VSCODE_AIONUI_INTEGRATION=1
  ↓
Preload Script (Node.js + Electron API)
  ↓ 读取 process.env
  ↓ 通过 contextBridge 暴露
  ↓
Renderer Process (Browser)
  ↓ 通过 window.electronAPI 访问
  ↓ 决定是否初始化 Sentry
```

### 为什么之前的方法失败

```typescript
// ❌ 失败：渲染进程中没有 process 对象
const isVSCodeIntegration = process.env?.VSCODE_AIONUI_INTEGRATION === '1';

// ✅ 成功：通过 preload 暴露的 API
const isVSCodeIntegration = window.electronAPI?.isVSCodeIntegration;
```

## 文件修改记录

1. ✅ `extensions/aionui-main/src/preload.ts` - 暴露标志
2. ✅ `extensions/aionui-main/src/renderer/main.tsx` - 使用标志
3. ✅ `src/vs/aionui/electron-main/aionuiWindowManager.js` - 移除 sentry-ipc 协议
4. ✅ 重新构建并部署

## 测试脚本

```bash
# 快速测试
./test-sentry-fix.sh

# 或手动测试
./test-vscode-aionui.sh
```

# AionUI 打包和启动最终测试报告

## 测试日期
2026-03-29

## 问题描述
AionUI 资源文件已成功打包，但通过命令启动时报错：`ERR_FAILED (-2) loading file://...`

## 根本原因
VS Code 的安全策略拦截了所有 `file://` 协议的请求。VS Code 只允许通过 `vscode-file://` 协议加载本地资源。

相关代码位置：`src/vs/platform/protocol/electron-main/protocolMainService.ts`

```typescript
// Block any file:// access
defaultSession.protocol.interceptFileProtocol(Schemas.file, (request, callback) =>
	this.handleFileRequest(request, callback)
);
```

## 解决方案

### 修改 `src/vs/aionui/electron-main/aionuiWindowManager.js`

将加载 URL 从 `file://` 协议改为 `vscode-file://` 协议：

```javascript
// 修改前（失败）
const fileUrl = pathToFileURL(indexPath).href;
await aionuiWindow.loadURL(fileUrl);

// 修改后（成功）
const vscodeFileUrl = `vscode-file://vscode-app${indexPath}`;
await aionuiWindow.loadURL(vscodeFileUrl);
```

### 关键代码变更

```javascript
/**
 * Launch AionUI as a BrowserWindow in the same process (production mode)
 * @returns {Promise<void>}
 */
async launchAionUIInProcess() {
	const electron = await import('electron');
	const { BrowserWindow } = electron;
	const { existsSync } = await import('fs');

	// Path to AionUI build output
	const aionuiDistPath = join(this.environmentService.appRoot, 'out', 'aionui', 'dist');
	const indexPath = join(aionuiDistPath, 'renderer', 'index.html');
	const preloadPath = join(aionuiDistPath, 'preload', 'index.js');

	// Verify files exist
	if (!existsSync(indexPath)) {
		throw new Error(`AionUI index.html not found at: ${indexPath}`);
	}

	if (!existsSync(preloadPath)) {
		throw new Error(`AionUI preload.js not found at: ${preloadPath}`);
	}

	// Create AionUI window
	const aionuiWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		title: 'AionUI',
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: preloadPath,
			webSecurity: true,
			allowRunningInsecureContent: false,
			sandbox: false
		}
	});

	// Enable DevTools for debugging
	aionuiWindow.webContents.openDevTools();

	// Load AionUI using vscode-file:// protocol (VS Code blocks file:// protocol)
	const vscodeFileUrl = `vscode-file://vscode-app${indexPath}`;
	await aionuiWindow.loadURL(vscodeFileUrl);

	// Store reference and handle window close
	this.aionuiProcess = { killed: false };
	aionuiWindow.on('closed', () => {
		this.aionuiProcess = null;
	});
}
```

## 测试结果

### ✅ 启动测试成功

```bash
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui
```

**日志输出：**
```
[main] AionUIWindowManager#launchAionUI - launching AionUI in production mode
[main] AionUIWindowManager#launchAionUIInProcess {
  aionuiDistPath: '.../app/out/aionui/dist',
  indexPath: '.../app/out/aionui/dist/renderer/index.html',
  preloadPath: '.../app/out/aionui/dist/preload/index.js',
  indexExists: true,
  preloadExists: true
}
[main] AionUIWindowManager#launchAionUIInProcess - loading URL {
  vscodeFileUrl: 'vscode-file://vscode-app/Users/lujs/VSCode-darwin-arm64/...'
}
[main] AionUIWindowManager#launchAionUIInProcess - successfully loaded index.html
[main] AionUIWindowManager#launchAionUIInProcess - AionUI window created
```

### ✅ 窗口创建成功
- AionUI 窗口成功打开
- DevTools 自动打开（用于调试）
- HTML 页面成功加载
- 无加载错误

### ✅ 资源文件验证
```
✅ out/aionui/dist/main/index.js (2.3 MB)
✅ out/aionui/dist/preload/index.js
✅ out/aionui/dist/renderer/index.html
✅ out/aionui/dist/renderer/assets/* (483 files)
✅ out/aionui/resources/* (49 files)
✅ out/vs/aionui/electron-main/aionuiWindowManager.js
```

## 完整的修改清单

### 1. `build/gulpfile.vscode.ts`
添加 AionUI 资源文件的打包逻辑

### 2. `src/vs/aionui/electron-main/aionuiWindowManager.js`
- 修改为使用 `vscode-file://` 协议
- 添加文件存在性验证
- 添加详细的日志输出
- 添加错误处理
- 启用 DevTools 用于调试

### 3. `scripts/verify-aionui-package.sh`
创建跨平台的打包验证脚本

## 启动命令

### macOS
```bash
# 启动 AionUI
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui

# 或者使用 open 命令
open "../VSCode-darwin-arm64/Code - OSS.app" --args --aionui
```

### Linux
```bash
./VSCode-linux-x64/code-oss --aionui
```

### Windows
```cmd
VSCode-win32-x64\Code - OSS.exe --aionui
```

## 技术要点

### VS Code 协议系统
1. `file://` - 被 VS Code 拦截，不允许直接访问
2. `vscode-file://` - VS Code 的安全文件协议，允许访问白名单路径
3. `vscode-webview://` - 用于 webview 内容
4. `vscode-remote-resource://` - 用于远程资源

### 白名单路径
VS Code 只允许从以下路径加载资源：
- `appRoot` - 应用安装目录
- `extensionsPath` - 扩展目录
- `globalStorageHome` - 全局存储
- `workspaceStorageHome` - 工作区存储

AionUI 的资源位于 `appRoot/out/aionui/dist`，因此在白名单内。

### URL 格式
```
vscode-file://vscode-app<absolute-path>
```

示例：
```
vscode-file://vscode-app/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/dist/renderer/index.html
```

## 后续优化建议

1. **移除 DevTools 自动打开**
   - 在生产环境中应该禁用
   - 只在开发模式下启用

2. **添加窗口状态管理**
   - 保存窗口位置和大小
   - 支持最小化/最大化状态恢复

3. **改进错误处理**
   - 添加用户友好的错误提示
   - 提供重试机制

4. **性能优化**
   - 延迟加载非关键资源
   - 使用缓存策略

5. **跨平台测试**
   - 在 Linux 上测试
   - 在 Windows 上测试

## 结论

✅ **问题已完全解决**

- AionUI 资源文件成功打包
- AionUI 窗口成功创建和加载
- 使用 `vscode-file://` 协议绕过了 VS Code 的安全限制
- 所有修改都使用 `test-workbench_change` 标记

**当前状态：**
- ✅ VS Code 成功启动
- ✅ AionUI 窗口管理器成功初始化
- ✅ AionUI 资源文件正确打包
- ✅ AionUI 窗口成功打开并加载

**下一步：**
测试 AionUI 的完整功能，确保所有 UI 组件和交互正常工作。

# test-workbench-vscode 与 AionUI 集成分析

## 📋 目录

1. [集成概述](#集成概述)
2. [架构设计](#架构设计)
3. [核心组件](#核心组件)
4. [集成流程](#集成流程)
5. [关键技术点](#关键技术点)
6. [与 OpenCode 的对比](#与-opencode-的对比)

---

## 集成概述

### 什么是这个项目？

**test-workbench-vscode** 是一个 VS Code 的 fork 版本，它将 **AionUI**（一个独立的 Electron AI 助手应用）集成到 VS Code 中，使用户可以在 VS Code 内部直接启动和使用 AionUI。

### 集成方式

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code (主应用)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  命令行参数: --aionui                                 │   │
│  │  命令面板: "Open AionUI Window"                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                    │
│                         ▼                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  AionUIWindowManager                                 │   │
│  │  - 创建独立的 BrowserWindow                          │   │
│  │  - 加载 AionUI 应用                                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              AionUI (独立窗口)                               │
│  - 完整的 AI 聊天界面                                        │
│  - 支持多种 AI 后端 (Claude, Gemini, OpenCode, etc.)        │
│  - 文件操作、代码生成等功能                                  │
└─────────────────────────────────────────────────────────────┘
```

### 关键特点

1. **非侵入式集成**：AionUI 作为独立窗口运行，不修改 VS Code 核心功能
2. **保持独立性**：AionUI 源码保持不变，位于 `extensions/aionui-main/`
3. **统一打包**：AionUI 随 VS Code 一起打包和分发
4. **双重启动方式**：
   - 命令行：`code --aionui`
   - 命令面板：`Open AionUI Window`

---

## 架构设计

### 目录结构

```
test-workbench-vscode/
│
├── extensions/
│   └── aionui-main/                    # AionUI 完整源码（保持不变）
│       ├── src/
│       │   ├── main/                   # Electron 主进程
│       │   ├── preload/                # Preload 脚本
│       │   └── renderer/               # React 前端应用
│       ├── package.json
│       ├── electron.vite.config.ts
│       └── out/                        # AionUI 构建输出
│           ├── main/
│           ├── preload/
│           └── renderer/
│
├── src/vs/aionui/                      # VS Code 集成代码（新增）
│   ├── electron-main/
│   │   └── aionuiWindowManager.js      # 窗口管理器（核心）
│   ├── common/
│   │   └── aionui.ts                   # 常量定义
│   └── browser/
│       └── aionui.contribution.ts      # 命令注册
│
├── build/
│   └── gulpfile.vscode.ts              # 构建配置（已修改）
│
└── out/                                # VS Code 构建输出
    ├── vs/
    │   └── aionui/
    │       └── electron-main/
    │           └── aionuiWindowManager.js
    └── aionui/                         # AionUI 打包产物
        ├── dist/
        │   ├── main/
        │   ├── preload/
        │   └── renderer/
        └── resources/
```

### 模块关系图

```
┌─────────────────────────────────────────────────────────────┐
│                VS Code 主进程启动                            │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  src/vs/code/electron-main/main.ts                          │
│  - 解析命令行参数 --aionui                                   │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  src/vs/platform/windows/electron-main/windowsMainService.ts│
│  - openAionUIWindow()                                       │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  src/vs/aionui/electron-main/aionuiWindowManager.js        │
│  - launchAionUI()                                           │
│  - launchAionUIInProcess()                                  │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Electron BrowserWindow                                     │
│  - 加载: vscode-file://vscode-app/.../index.html           │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  AionUI React 应用                                          │
│  - 完整的 UI 和功能                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心组件

### 1. AionUIWindowManager

**位置**：`src/vs/aionui/electron-main/aionuiWindowManager.js`

**职责**：
- 管理 AionUI 窗口的生命周期
- 处理窗口创建、显示、关闭
- 加载 AionUI 应用内容

**关键代码**：

```javascript
class AionUIWindowManager {
    constructor(environmentService, logService) {
        this.environmentService = environmentService;
        this.logService = logService;
        this.aionuiProcess = null;
    }

    /**
     * 启动 AionUI（生产模式）
     */
    async launchAionUIInProcess() {
        const { BrowserWindow } = await import('electron');

        // 构建路径
        const aionuiDistPath = join(
            this.environmentService.appRoot,
            'out', 'aionui', 'dist'
        );
        const indexPath = join(aionuiDistPath, 'renderer', 'index.html');
        const preloadPath = join(aionuiDistPath, 'preload', 'index.js');

        // 创建窗口
        const aionuiWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            title: 'AionUI',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath,
                webSecurity: true,
                sandbox: false
            }
        });

        // 使用 vscode-file:// 协议加载（关键！）
        const vscodeFileUrl = `vscode-file://vscode-app${indexPath}`;
        await aionuiWindow.loadURL(vscodeFileUrl);

        // 存储引用
        this.aionuiProcess = { killed: false };
        aionuiWindow.on('closed', () => {
            this.aionuiProcess = null;
        });
    }
}
```

**关键技术点**：

1. **协议选择**：使用 `vscode-file://` 而不是 `file://`
   - VS Code 拦截所有 `file://` 请求
   - `vscode-file://vscode-app` 是 VS Code 的安全协议
   - 只允许访问白名单路径（appRoot 在白名单内）

2. **安全配置**：
   - `contextIsolation: true` - 隔离上下文
   - `nodeIntegration: false` - 禁用 Node 集成
   - `webSecurity: true` - 启用 Web 安全
   - `sandbox: false` - 禁用沙箱（AionUI 需要）

### 2. WindowsMainService 扩展

**位置**：`src/vs/platform/windows/electron-main/windowsMainService.ts`

**修改内容**：

```typescript
// test-workbench_change start
async openAionUIWindow(): Promise<void> {
    this.logService.trace('windowsManager#openAionUIWindow');

    // 延迟加载 AionUIWindowManager
    if (!this.aionuiWindowManager) {
        const { AionUIWindowManager } = await import(
            '../../aionui/electron-main/aionuiWindowManager.js'
        );
        this.aionuiWindowManager = this.instantiationService.createInstance(
            AionUIWindowManager
        );
    }

    // 启动 AionUI
    await this.aionuiWindowManager.launchAionUI();
}
// test-workbench_change end
```

### 3. 命令行参数处理

**位置**：`src/vs/code/electron-main/main.ts`

**修改内容**：

```typescript
// test-workbench_change start
// Handle --aionui flag
if (args['aionui']) {
    this.logService.trace('main#open - aionui flag detected');
    await this.windowsMainService.openAionUIWindow();
    return;
}
// test-workbench_change end
```

### 4. 命令面板命令

**位置**：`src/vs/aionui/browser/aionui.contribution.ts`

**内容**：

```typescript
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IWindowsMainService }

}

registerAction2(OpenAionUIWindowAction);
```

---

## 集成流程

### 构建流程

```
1. 构建 AionUI
   ├─ cd extensions/aionui-main
   ├─ bun install
   └─ bun run package
        └─ 输出到 extensions/aionui-main/out/
            ├─ main/index.js
            ├─ preload/index.js
            └─ renderer/
                ├─ index.html
                └─ assets/

2. 打包 VS Code
   ├─ npm run gulp vscode-darwin-arm64
   └─ Gulp 任务执行：
        ├─ 编译 VS Code 源码
        ├─ 复制 AionUI 构建产物
        │   └─ extensions/aionui-main/out/ → out/aionui/dist/
        └─ 复制 AionUI 资源文件
            └─ extensions/aionui-main/resources/ → out/aionui/resources/

3. 最终打包结构
   VSCode-darwin-arm64/
   └─ Code - OSS.app/
       └─ Contents/
           └─ Resources/
               └─ app/
                   ├─ out/
                   │   ├─ vs/              # VS Code 代码
                   │   └─ aionui/          # AionUI 打包产物
                   │       ├─ dist/
                   │       │   ├─ main/
                   │       │   ├─ preload/
                   │       │   └─ renderer/
                   │       └─ resources/
                   └─ extensions/
                       └─ aionui-main/     # AionUI 源码（可选）
```

### 运行时流程

```
1. 用户启动
   ├─ 方式 1: code --aionui
   └─ 方式 2: 命令面板 → "Open AionUI Window"

2. VS Code 主进程
   ├─ 解析参数/命令
   ├─ 调用 windowsMainService.openAionUIWindow()
   └─ 创建 AionUIWindowManager 实例

3. AionUIWindowManager
   ├─ 检查环境（开发/生产）
   ├─ 构建文件路径
   │   ├─ indexPath: .../out/aionui/dist/renderer/index.html
   │   └─ preloadPath: .../out/aionui/dist/preload/index.js
   ├─ 创建 BrowserWindow
   └─ 加载 URL: vscode-file://vscode-app<indexPath>

4. Electron 渲染进程
   ├─ 加载 index.html
   ├─ 执行 preload.js
   ├─ 加载 React 应用
   └─ 渲染 AionUI 界面

5. AionUI 应用运行
   ├─ 初始化 React 组件
   ├─ 连接 AI 后端
   └─ 提供完整功能
```

---

## 关键技术点

### 1. VS Code 协议系统

VS Code 使用自定义协议来加载本地资源，而不是标准的 `file://` 协议。

**协议类型**：

| 协议 | 用途 | 是否可用 |
|------|------|----------|
| `file://` | 标准文件协议 | ❌ 被 VS Code 拦截 |
| `vscode-file://vscode-app` | VS Code 应用资源 | ✅ 可用于 appRoot |
| `vscode-webview://` | Webview 内容 | ✅ 用于扩展 |
| `vscode-remote-resource://` | 远程资源 | ✅ 用于远程开发 |

**为什么需要 `vscode-file://`？**

```typescript
// src/vs/platform/protocol/electron-main/protocolMainService.ts

// VS Code 拦截所有 file:// 请求
defaultSession.protocol.interceptFileProtocol(
    Schemas.file,
    (request, callback) => this.handleFileRequest(request, callback)
);

// 只允许访问白名单路径
private handleFileRequest(request: ProtocolRequest, callback: ProtocolCallback) {
    const uri = URI.parse(request.url);

    // 检查路径是否在白名单内
    if (!this.isAllowedPath(uri.fsPath)) {
        callback({ error: -2 }); // ERR_FAILED
        return;
    }

    callback({ path: uri.fsPath });
}
```

**白名单路径**：
- `appRoot` - 应用安装目录 ✅
- `extensionsPath` - 扩展目录 ✅
- `globalStorageHome` - 全局存储 ✅
- `workspaceStorageHome` - 工作区存储 ✅

AionUI 的资源位于 `appRoot/out/aionui/dist`，因此在白名单内。

### 2. Electron 安全配置

```javascript
webPreferences: {
    nodeIntegration: false,      // 禁用 Node.js 集成（安全）
    contextIsolation: true,      // 隔离上下文（安全）
    preload: preloadPath,        // Preload 脚本路径
    webSecurity: true,           // 启用 Web 安全
    allowRunningInsecureContent: false,  // 禁止不安全内容
    sandbox: false               // 禁用沙箱（AionUI 需要）
}
```

**为什么 `sandbox: false`？**

AionUI 需要访问某些 Node.js API（通过 preload 脚本），沙箱模式会阻止这些访问。

### 3. 构建系统集成

**Gulp 任务**：`build/gulpfile.vscode.ts`

```typescript
// test-workbench_change start
// Copy AionUI build artifacts
gulp.task('copy-aionui', () => {
    const aionuiSrc = 'extensions/aionui-main/out';
    const aionuiDest = 'out/aionui/dist';

    return gulp.src(`${aionuiSrc}/**/*`)
        .pipe(gulp.dest(aionuiDest));
});

// Copy AionUI resources
gulp.task('copy-aionui-resources', () => {
    const resourcesSrc = 'extensions/aionui-main/resources';
    const resourcesDest = 'out/aionui/resources';

    return gulp.src(`${resourcesSrc}/**/*`)
        .pipe(gulp.dest(resourcesDest));
});

// Add to main build task
gulp.task('vscode-darwin-arm64', gulp.series(
    'copy-aionui',
    'copy-aionui-resources',
    // ... other tasks
));
// test-workbench_change end
```

### 4. 开发模式支持

**开发工作流**：

```bash
# 终端 1: 启动 VS Code 开发模式
cd test-workbench-vscode
./scripts/code.sh

# 终端 2: 启动 AionUI 开发服务器
cd extensions/aionui-main
bun run start  # 启动在 localhost:5173
```

**AionUIWindowManager 检测开发模式**：

```javascript
async launchAionUI() {
    const isDevelopment = !this.environmentService.isBuilt;

    if (isDevelopment) {
        // 检查开发服务器是否运行
        const devServerUrl = 'http://localhost:5173';
        const isDevServerRunning = await this.checkDevServer(devServerUrl);

        if (isDevServerRunning) {
            // 加载开发服务器
            await aionuiWindow.loadURL(devServerUrl);
        } else {
            // 回退到构建文件
            await this.launchAionUIInProcess();
        }
    } else {
        // 生产模式
        await this.launchAionUIInProcess();
    }
}
```

---

## 与 OpenCode 的对比

### OpenCode 的集成方式

根据之前的分析，OpenCode 通过 **ACP (Agent Communication Protocol)** 协议与 AionUI 集成：

```
AionUI
  ↓ (通过 ACP 协议)
  ↓ spawn('opencode', ['acp'])
  ↓
OpenCode CLI
  ↓ (JSON-RPC 消息)
  ↓
AI 模型 (Claude, GPT, etc.)
```

**OpenCode 集成特点**：
- 作为独立的 CLI 工具运行
- 通过子进程通信
- 使用 JSON-RPC 协议
- 支持多种 AI 后端

### test-workbench-vscode 的集成方式

```
VS Code
  ↓ (直接集成)
  ↓ BrowserWindow
  ↓
AionUI (完整应用)
  ↓ (内置 ACP 支持)
  ↓
多种 AI 后端 (包括 OpenCode)
```

**test-workbench-vscode 集成特点**：
- AionUI 作为 VS Code 的一部分
- 在同一进程中运行（独立窗口）
- 直接访问 VS Code 资源
- 可以与 VS Code 进行深度集成

### 对比表

| 维度 | OpenCode 集成 | test-workbench-vscode 集成 |
|------|--------------|---------------------------|
| **集成方式** | 外部 CLI 工具 | 内置窗口 |
| **通信协议** | ACP (JSON-RPC) | 直接调用 |
| **进程模型** | 独立进程 | 同进程（独立窗口） |
| **启动方式** | `opencode acp` | `code --aionui` |
| **资源访问** | 受限 | 完全访问 |
| **更新方式** | 独立更新 | 随 VS Code 更新 |
| **用户体验** | 需要安装 CLI | 开箱即用 |

### 为什么选择这种集成方式？

1. **用户体验**：
   - 无需安装额外的 CLI 工具
   - 一键启动，开箱即用
   - 统一的更新和分发

2. **功能完整性**：
   - AionUI 保持完整功能
   - 支持所有 AI 后端（包括 OpenCode）
   - 可以访问 VS Code 的资源和 API

3. **维护性**：
   - AionUI 源码独立，易于更新
   - VS Code 集成代码最小化
   - 使用 `test-workbench_change` 标记便于合并

---

## 总结

### 集成架构总结

```
┌─────────────────────────────────────────────────────────────┐
│                  test-workbench-vscode                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  VS Code 核心                                      │     │
│  │  - 编辑器                                          │     │
│  │  - 扩展系统                                        │     │
│  │  - 终端                                            │     │
│  └────────────────────────────────────────────────────┘     │
│                         │                                    │
│                         │ 集成层                             │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────┐     │
│  │  AionUIWindowManager                               │     │
│  │  - 窗口管理                                        │     │
│  │  - 生命周期控制                                    │     │
│  └────────────────────────────────────────────────────┘     │
│                         │                                    │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────┐     │
│  │  AionUI (完整应用)                                 │     │
│  │  - AI 聊天界面                                     │     │
│  │  - 多后端支持                                      │     │
│  │  - 文件操作                                        │     │
│  │  - 代码生成                                        │     │
│  └────────────────────────────────────────────────────┘     │
│                         │                                    │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────┐     │
│  │  AI 后端                                           │     │
│  │  - Claude Code                                     │     │
│  │  - Gemini                                          │     │
│  │  - OpenCode ← 通过 ACP 协议                        │     │
│  │  - Codex                                           │     │
│  │  - 其他...                                         │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 关键成功因素

1. **协议选择**：使用 `vscode-file://` 协议绕过 VS Code 的安全限制
2. **最小化修改**：只在必要的地方添加集成代码，使用标记便于维护
3. **保持独立性**：AionUI 源码不变，作为独立模块存在
4. **统一打包**：通过 Gulp 任务自动化构建和打包流程

### 下一步

1. **功能测试**：测试 AionUI 的所有功能是否正常
2. **性能优化**：优化窗口创建和加载速度
3. **跨平台测试**：在 Windows 和 Linux 上测试
4. **文档完善**：编写用户手册和开发文档
5. **发布准备**：创建安装包和分发渠道

---

## 附录

### 相关文档

- [设计文档](./design.md) - 详细的架构设计
- [构建指南](./BUILD_README.md) - 快速打包指南
- [测试报告](./AIONUI_FINAL_TEST_REPORT.md) - 最终测试结果

### 标记说明

所有集成代码都使用 `test-workbench_change` 标记：

```typescript
// test-workbench_change start
// 集成代码
// test-workbench_change end
```

这样便于：
- 识别哪些代码是集成添加的
- 在合并上游更新时避免冲突
- 维护和更新集成代码

### 联系方式

如有问题，请查看：
- GitHub Issues
- 开发文档
- 社区论坛

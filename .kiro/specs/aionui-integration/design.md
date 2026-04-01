# AionUI 集成到 VS Code - 设计文档

## 1. 架构设计

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code 主进程                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           WindowsMainService                             │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  openAionUIWindow()                                │  │   │
│  │  │  - 检查现有窗口                                     │  │   │
│  │  │  - 创建/聚焦 BrowserWindow                         │  │   │
│  │  │  - 加载 AionUI 内容                                │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           AionUIWindowManager                            │   │
│  │  - 窗口生命周期管理                                       │   │
│  │  - 单例模式控制                                          │   │
│  │  - IPC 通信桥接                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AionUI Electron 窗口                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  开发模式: http://localhost:5173                         │   │
│  │  生产模式: file:///.../aionui/dist/index.html           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           AionUI React 应用                              │   │
│  │  - 完整的 AI 聊天界面                                    │   │
│  │  - 独立的状态管理                                        │   │
│  │  - 原生功能保持不变                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 目录结构

```
test-workbench-vscode/
├── extensions/
│   └── aionui-main/                    # AionUI 源码（保持不变）
│       ├── src/
│       ├── package.json
│       ├── electron.vite.config.ts
│       └── ...
│
├── src/vs/aionui/                      # VS Code 集成代码（新增）
│   ├── electron-main/
│   │   ├── aionuiWindowManager.ts      # 窗口管理器
│   │   └── aionuiMain.ts               # 主进程入口
│   ├── common/
│   │   ├── aionui.ts                   # 常量和类型定义
│   │   └── aionuiIpc.ts                # IPC 协议定义
│   └── browser/
│       └── aionui.contribution.ts      # 命令和 UI 贡献
│
├── build/
│   └── gulpfile.aionui.js              # AionUI 构建任务（新增）
│
└── out/                                # 构建输出
    └── aionui/                         # AionUI 构建产物
        └── dist/
            └── index.html
```

### 1.3 模块依赖关系

```
VS Code 主进程
    ↓
AionUIWindowManager (src/vs/aionui/electron-main/)
    ↓
Electron BrowserWindow
    ↓
AionUI 应用 (extensions/aionui-main/)
```

## 2. 核心组件设计

### 2.1 AionUIWindowManager

**职责**：
- 管理 AionUI 窗口的生命周期
- 实现单例模式
- 处理窗口创建、显示、隐藏、关闭
- 提供 IPC 通信桥接

**接口设计**：

```typescript
// src/vs/aionui/electron-main/aionuiWindowManager.ts

export interface IAionUIWindowManager {
    /**
     * 打开或聚焦 AionUI 窗口
     */
    openWindow(): Promise<void>;

    /**
     * 关闭 AionUI 窗口
     */
    closeWindow(): void;

    /**
     * 检查窗口是否已打开
     */
    isWindowOpen(): boolean;

    /**
     * 获取窗口实例
     */
    getWindow(): BrowserWindow | null;
}

export class AionUIWindowManager implements IAionUIWindowManager {
    private window: BrowserWindow | null = null;
    private readonly is
0,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            title: 'AionUI - AI Assistant',
            icon: this.getIconPath(),
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                preload: this.getPreloadPath()
            }
        });

        // 加载内容
        const url = this.getLoadUrl();
        await this.window.loadURL(url);

        // 开发模式下打开 DevTools
        if (this.isDevelopment) {
            this.window.webContents.openDevTools();
        }

        // 监听窗口关闭
        this.window.on('closed', () => {
            this.window = null;
        });

        this.window.show();
    }

    closeWindow(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.close();
        }
    }

    isWindowOpen(): boolean {
        return this.window !== null && !this.window.isDestroyed();
    }

    getWindow(): BrowserWindow | null {
        return this.window;
    }

    private getLoadUrl(): string {
        if (this.isDevelopment) {
            // 开发模式：连接到 Vite 开发服务器
            return 'http://localhost:5173';
        } else {
            // 生产模式：加载打包后的文件
            const distPath = path.join(
                this.environmentService.appRoot,
                'out',
                'aionui',
                'dist',
                'index.html'
            );
            return `file://${distPath}`;
        }
    }

    private getIconPath(): string {
        return path.join(
            this.environmentService.appRoot,
            'extensions',
            'aionui-main',
            'resources',
            'app.png'
        );
    }

    private getPreloadPath(): string {
        return path.join(
            this.environmentService.appRoot,
            'out',
            'aionui',
            'preload.js'
        );
    }
}
```

### 2.2 WindowsMainService 扩展

**修改位置**：`src/vs/platform/windows/electron-main/windowsMainService.ts`

**新增方法**：

```typescript
// 在 WindowsMainService 类中添加

async openAionUIWindow(): Promise<void> {
    this.logService.trace('windowsManager#openAionUIWindow');

    // 获取或创建 AionUIWindowManager
    if (!this.aionuiWindowManager) {
        this.aionuiWindowManager = this.instantiationService.createInstance(
            AionUIWindowManager
        );
    }

    // 打开窗口
    await this.aionuiWindowManager.openWindow();
}
```

### 2.3 命令行参数处理

**修改位置**：`src/vs/platform/launch/electron-main/launchMainService.ts`

**新增逻辑**：

```typescript
// 在 open() 方法中添加

// AionUI window
if (args['aionui']) {
    await this.windowsMainService.openAionUIWindow();
    return;
}
```

### 2.4 命令面板命令

**新增文件**：`src/vs/aionui/browser/aionui.contribution.ts`

```typescript
import { localize } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { INativeHostService } from '../../../platform/native/common/native.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';

export class OpenAionUIWindowAction extends Action2 {
    constructor() {
        super({
            id: 'workbench.action.openAionUIWindow',
            title: localize('openAionUIWindow', "Open AionUI Window"),
            category: localize('aionui', "AionUI"),
            f1: true // 显示在命令面板
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const nativeHostService = accessor.get(INativeHostService);
        await nativeHostService.openAionUIWindow();
    }
}

// 注册命令
registerAction2(OpenAionUIWindowAction);
```

### 2.5 状态栏按钮（可选）

**新增文件**：`src/vs/aionui/browser/aionuiStatusbarItem.ts`

```typescript
import { Disposable } from '../../../base/common/lifecycle.js';
import { IStatusbarService, StatusbarAlignment } from '../../../workbench/services/statusbar/browser/statusbar.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { ThemeIcon } from '../../../base/common/themables.js';

export class AionUIStatusbarItem extends Disposable {
    constructor(
        @IStatusbarService private readonly statusbarService: IStatusbarService,
        @ICommandService private readonly commandService: ICommandService
    ) {
        super();
        this.registerStatusbarItem();
    }

    private registerStatusbarItem(): void {
        const entry = {
            name: 'AionUI',
            text: '$(robot) AionUI',
            tooltip: 'Open AionUI Window',
            command: 'workbench.action.openAionUIWindow',
            ariaLabel: 'Open AionUI Window'
        };

        this._register(
            this.statusbarService.addEntry(
                entry,
                'aionui.statusbar',
                StatusbarAlignment.RIGHT,
                100
            )
        );
    }
}
```

## 3. 构建系统设计

### 3.1 构建流程

```
VS Code 构建触发
    ↓
Gulp 任务: build-aionui
    ↓
1. 检查 AionUI 依赖
    ↓
2. 运行 AionUI 构建
   (cd extensions/aionui-main && bun run package)
    ↓
3. 复制构建产物
   extensions/aionui-main/out/ → out/aionui/
    ↓
4. 复制资源文件
   extensions/aionui-main/resources/ → out/aionui/resources/
    ↓
VS Code 构建完成
```

### 3.2 Gulp 任务定义

**新增文件**：`build/gulpfile.aionui.js`

```javascript
const gulp = require('gulp');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs-extra');

const AIONUI_ROOT = path.join(__dirname, '..', 'extensions', 'aionui-main');
const OUT_DIR = path.join(__dirname, '..', 'out', 'aionui');

// 构建 AionUI
gulp.task('build-aionui', async () => {
    console.log('Building AionUI...');

    // 检查 AionUI 目录
    if (!fs.existsSync(AIONUI_ROOT)) {
        throw new Error('AionUI directory not found');
    }

    // 安装依赖（如果需要）
    if (!fs.existsSync(path.join(AIONUI_ROOT, 'node_modules'))) {
        console.log('Installing AionUI dependencies...');
        await runCommand('bun', ['install'], AIONUI_ROOT);
    }

    // 运行构建
    console.log('Running AionUI build...');
    await runCommand('bun', ['run', 'package'], AIONUI_ROOT);

    // 复制构建产物
    console.log('Copying AionUI build artifacts...');
    await fs.ensureDir(OUT_DIR);
    await fs.copy(
        path.join(AIONUI_ROOT, 'out'),
        path.join(OUT_DIR, 'dist')
    );

    // 复制资源文件
    await fs.copy(
        path.join(AIONUI_ROOT, 'resources'),
        path.join(OUT_DIR, 'resources')
    );

    console.log('AionUI build complete!');
});

// 清理 AionUI 构建产物
gulp.task('clean-aionui', async () => {
    await fs.remove(OUT_DIR);
    await fs.remove(path.join(AIONUI_ROOT, 'out'));
});

// 开发模式：监听 AionUI 变化
gulp.task('watch-aionui', () => {
    console.log('Watching AionUI for changes...');
    console.log('Note: AionUI should be running in dev mode separately');
    console.log('Run: cd extensions/aionui-main && bun run start');
});

function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: 'inherit',
            shell: true
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });

        child.on('error', reject);
    });
}
```

### 3.3 集成到主构建流程

**修改文件**：`build/gulpfile.vscode.js`

```javascript
// 在文件末尾添加

// 导入 AionUI 构建任务
require('./gulpfile.aionui');

// 将 AionUI 构建添加到主构建流程
gulp.task('vscode-darwin-min', gulp.series(
    'build-aionui',  // 新增
    'minify-vscode',
    // ... 其他任务
));

gulp.task('vscode-win32-min', gulp.series(
    'build-aionui',  // 新增
    'minify-vscode',
    // ... 其他任务
));

gulp.task('vscode-linux-min', gulp.series(
    'build-aionui',  // 新增
    'minify-vscode',
    // ... 其他任务
));
```

## 4. IPC 通信设计（可选）

### 4.1 通信协议

**新增文件**：`src/vs/aionui/common/aionuiIpc.ts`

```typescript
// IPC 频道定义
export const enum AionUIChannel {
    // VS Code → AionUI
    GetWorkspaceInfo = 'aionui:getWorkspaceInfo',
    GetCurrentFile = 'aionui:getCurrentFile',

    // AionUI → VS Code
    OpenFile = 'aionui:openFile',
    ShowMessage = 'aionui:showMessage'
}

// 消息类型
export interface IWorkspaceInfo {
    folders: string[];
    name: string;
}

export interface ICurrentFile {
    path: string;
    content: string;
}

export interface IOpenFileRequest {
    path: string;
    line?: number;
    column?: number;
}
```

### 4.2 IPC 处理器

**在 AionUIWindowManager 中添加**：

```typescript
private setupIpcHandlers(): void {
    const window = this.window;
    if (!window) return;

    // 处理来自 AionUI 的请求
    ipcMain.handle(AionUIChannel.GetWorkspaceInfo, async () => {
        return this.getWorkspaceInfo();
    });

    ipcMain.handle(AionUIChannel.GetCurrentFile, async () => {
        return this.getCurrentFile();
    });

    ipcMain.handle(AionUIChannel.OpenFile, async (event, request: IOpenFileRequest) => {
        return this.openFile(request);
    });
}

private async getWorkspaceInfo(): Promise<IWorkspaceInfo> {
    // 从 VS Code 获取工作区信息
    // 实现细节...
}

private async getCurrentFile(): Promise<ICurrentFile> {
    // 从 VS Code 获取当前文件
    // 实现细节...
}

private async openFile(request: IOpenFileRequest): Promise<void> {
    // 在 VS Code 中打开文件
    // 实现细节...
}
```

## 5. 开发模式设计

### 5.1 开发工作流

```
终端 1: VS Code 开发
$ cd test-workbench-vscode
$ ./scripts/code.sh

终端 2: AionUI 开发
$ cd extensions/aionui-main
$ bun run start

结果:
- VS Code 运行在调试模式
- AionUI 运行在 localhost:5173
- VS Code 的 AionUI 窗口加载 localhost:5173
- 支持热重载
```

### 5.2 环境检测

```typescript
// 在 AionUIWindowManager 中

private getLoadUrl(): string {
    // 检查是否在开发模式
    const isDev = !this.environmentService.isBuilt;

    if (isDev) {
        // 检查 AionUI 开发服务器是否运行
        const devServerUrl = 'http://localhost:5173';

        // 尝试连接
        return this.checkDevServer(devServerUrl)
            .then(available => {
                if (available) {
                    this.logService.info('AionUI dev server detected, using hot reload');
                    return devServerUrl;
                } else {
                    this.logService.warn('AionUI dev server not running, using built files');
                    return this.getBuiltUrl();
                }
            });
    }

    return this.getBuiltUrl();
}

private async checkDevServer(url: string): Promise<boolean> {
    try {
        const response = await fetch(url);
        return response.ok;
    } catch {
        return false;
    }
}
```

## 6. 错误处理设计

### 6.1 窗口创建失败

```typescript
async openWindow(): Promise<void> {
    try {
        // ... 窗口创建逻辑
    } catch (error) {
        this.logService.error('Failed to open AionUI window', error);

        // 显示错误消息
        dialog.showErrorBox(
            'AionUI Error',
            `Failed to open AionUI window: ${error.message}`
        );

        throw error;
    }
}
```

### 6.2 构建失败处理

```javascript
// 在 gulpfile.aionui.js 中

gulp.task('build-aionui', async () => {
    try {
        // ... 构建逻辑
    } catch (error) {
        console.error('AionUI build failed:', error);

        // 在开发模式下，允许继续（使用旧的构建产物）
        if (process.env.NODE_ENV === 'development') {
            console.warn('Continuing with existing AionUI build...');
            return;
        }

        // 在生产模式下，构建失败应该中断
        throw error;
    }
});
```

### 6.3 IPC 通信失败

```typescript
// 在 IPC 处理器中添加错误处理

ipcMain.handle(AionUIChannel.GetWorkspaceInfo, async () => {
    try {
        return await this.getWorkspaceInfo();
    } catch (error) {
        this.logService.error('Failed to get workspace info', error);
        return {
            folders: [],
            name: 'Unknown',
            error: error.message
        };
    }
});
```

## 7. 性能优化设计

### 7.1 延迟加载

```typescript
// 只在需要时创建 AionUIWindowManager
private _aionuiWindowManager: AionUIWindowManager | null = null;

get aionuiWindowManager(): AionUIWindowManager {
    if (!this._aionuiWindowManager) {
        this._aionuiWindowManager = this.instantiationService.createInstance(
            AionUIWindowManager
        );
    }
    return this._aionuiWindowManager;
}
```

### 7.2 窗口预加载（可选）

```typescript
// 在 VS Code 启动时预创建窗口（隐藏）
async preloadAionUIWindow(): Promise<void> {
    if (this.window) return;

    this.window = new BrowserWindow({
        show: false,  // 不显示
        // ... 其他配置
    });

    await this.window.loadURL(this.getLoadUrl());
}

// 显示时直接 show
async openWindow(): Promise<void> {
    if (!this.window) {
        await this.preloadAionUIWindow();
    }

    this.window!.show();
}
```

### 7.3 构建缓存

```javascript
// 在 gulpfile.aionui.js 中

gulp.task('build-aionui', async () => {
    // 检查是否需要重新构建
    const needsRebuild = await checkIfRebuildNeeded();

    if (!needsRebuild) {
        console.log('AionUI is up to date, skipping build');
        return;
    }

    // ... 构建逻辑
});

async function checkIfRebuildNeeded() {
    const sourceDir = path.join(AIONUI_ROOT, 'src');
    const outDir = path.join(AIONUI_ROOT, 'out');

    if (!fs.existsSync(outDir)) {
        return true;
    }

    const sourceMtime = await getLatestMtime(sourceDir);
    const outMtime = await getLatestMtime(outDir);

    return sourceMtime > outMtime;
}
```

## 8. 测试策略

### 8.1 单元测试

```typescript
// tests/aionui/aionuiWindowManager.test.ts

describe('AionUIWindowManager', () => {
    let manager: AionUIWindowManager;

    beforeEach(() => {
        manager = new AionUIWindowManager(
            mockEnvironmentService,
            mockLogService
        );
    });

    test('should create window on first open', async () => {
        await manager.openWindow();
        expect(manager.isWindowOpen()).toBe(true);
    });

    test('should focus existing window on second open', async () => {
        await manager.openWindow();
        const window1 = manager.getWindow();

        await manager.openWindow();
        const window2 = manager.getWindow();

        expect(window1).toBe(window2);
    });

    test('should close window', () => {
        manager.openWindow();
        manager.closeWindow();
        expect(manager.isWindowOpen()).toBe(false);
    });
});
```

### 8.2 集成测试

```typescript
// tests/aionui/integration.test.ts

describe('AionUI Integration', () => {
    test('should open via command line', async () => {
        const result = await runVSCode(['--aionui']);
        expect(result.windows).toHaveLength(1);
        expect(result.windows[0].title).toContain('AionUI');
    });

    test('should open via command palette', async () => {
        const vscode = await launchVSCode();
        await vscode.executeCommand('workbench.action.openAionUIWindow');

        const windows = await vscode.getWindows();
        expect(windows).toHaveLength(2); // VS Code + AionUI
    });
});
```

### 8.3 E2E 测试

```typescript
// tests/aionui/e2e.test.ts

describe('AionUI E2E', () => {
    test('should display AionUI interface', async () => {
        const vscode = await launchVSCode();
        await vscode.executeCommand('workbench.action.openAionUIWindow');

        const aionuiWindow = await waitForWindow('AionUI');
        const content = await aionuiWindow.getContent();

        expect(content).toContain('AI Assistant');
    });

    test('should communicate with VS Code', async () => {
        const vscode = await launchVSCode();
        await vscode.openFile('test.txt');

        await vscode.executeCommand('workbench.action.openAionUIWindow');
        const aionuiWindow = await waitForWindow('AionUI');

        const workspaceInfo = await aionuiWindow.getWorkspaceInfo();
        expect(workspaceInfo.folders).toHaveLength(1);
    });
});
```

## 9. 部署设计

### 9.1 打包配置

```json
// package.json 中添加

{
  "scripts": {
    "build": "gulp vscode-darwin-min && gulp build-aionui",
    "build:win": "gulp vscode-win32-min && gulp build-aionui",
    "build:linux": "gulp vscode-linux-min && gulp build-aionui"
  }
}
```

### 9.2 发布检查清单

- [ ] AionUI 构建产物已包含在 VS Code 输出目录
- [ ] 所有平台的构建都成功
- [ ] 命令行参数 `--aionui` 正常工作
- [ ] 命令面板命令正常工作
- [ ] 窗口单例模式正常工作
- [ ] 开发模式和生产模式都正常工作
- [ ] 所有测试通过

## 10. 文档设计

### 10.1 用户文档

**文件**：`docs/aionui/USER_GUIDE.md`

内容：
- 如何启动 AionUI
- 功能介绍
- 常见问题

### 10.2 开发文档

**文件**：`docs/aionui/DEVELOPMENT.md`

内容：
- 架构说明
- 开发环境设置
- 构建流程
- 调试技巧

### 10.3 API 文档

**文件**：`docs/aionui/API.md`

内容：
- IPC 通信协议
- 扩展点
- 自定义配置

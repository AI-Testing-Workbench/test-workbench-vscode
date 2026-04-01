# OpenWork 集成到 VS Code - 设计文档

## 1. 架构设计

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code 主进程                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           WindowsMainService                             │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  openOpenWorkWindow()                              │  │   │
│  │  │  - 检查现有窗口                                     │  │   │
│  │  │  - 创建/聚焦 BrowserWindow                         │  │   │
│  │  │  - 加载 OpenWork 内容                              │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           OpenWorkWindowManager                          │   │
│  │  - 窗口生命周期管理                                       │   │
│  │  - 单例模式控制                                          │   │
│  │  - IPC 通信桥接                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenWork Electron 窗口                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  开发模式: http://localhost:5173                         │   │
│  │  生产模式: file:///.../openwork/dist/index.html         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           OpenWork SolidJS 应用                          │   │
│  │  - 完整的协作工作平台界面                                 │   │
│  │  - 独立的状态管理                                        │   │
│  │  - 原生功能保持不变                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 目录结构

```
test-workbench-vscode/
├── extensions/
│   └── openwork-dev/                   # OpenWork 源码（保持不变）
│       ├── apps/
│       │   ├── app/                    # Web 应用（用于集成）
│       │   ├── desktop/                # Tauri 桌面应用
│
work.js            # OpenWork 构建任务（新增）
│
└── out/                                # 构建输出
    └── openwork/                       # OpenWork 构建产物
        └── dist/
            └── index.html
```

### 1.3 模块依赖关系

```
VS Code 主进程
    ↓
OpenWorkWindowManager (src/vs/openwork/electron-main/)
    ↓
Electron BrowserWindow
    ↓
OpenWork Web 应用 (extensions/openwork-dev/apps/app/)
```

## 2. 核心组件设计

### 2.1 OpenWorkWindowManager

**职责**：
- 管理 OpenWork 窗口的生命周期
- 实现单例模式
- 处理窗口创建、显示、隐藏、关闭
- 提供 IPC 通信桥接

**接口设计**：

```typescript
// src/vs/openwork/electron-main/openworkWindowManager.ts
// test-workbench_change - new file

import { BrowserWindow } from 'electron';
import { IEnvironmentMainService } from '../../platform/environment/electron-main/environmentMainService.js';
import { ILogService } from '../../platform/log/common/log.js';
import * as path from 'path';

export interface IOpenWorkWindowManager {
    /**
     * 打开或聚焦 OpenWork 窗口
     */
    openWindow(): Promise<void>;

    /**
     * 关闭 OpenWork 窗口
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

export class OpenWorkWindowManager implements IOpenWorkWindowManager {
    private window: BrowserWindow | null = null;
    private readonly isDevelopment: boolean;

    constructor(
        @IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
        @ILogService private readonly logService: ILogService
    ) {
        this.isDevelopment = !environmentService.isBuilt;
    }

    async openWindow(): Promise<void> {
        // 如果窗口已存在，聚焦它
        if (this.window && !this.window.isDestroyed()) {
            this.window.focus();
            return;
        }

        // 创建新窗口
        await this.createWindow();
    }

    private async createWindow(): Promise<void> {
        this.logService.info('Creating OpenWork window');

        // 创建 BrowserWindow
        this.window = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 1024,
            minHeight: 768,
            title: 'OpenWork - Collaborative Workspace',
            icon: this.getIconPath(),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: this.getPreloadPath()
            }
        });

        // 加载内容
        const url = await this.getLoadUrl();
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

    private async getLoadUrl(): Promise<string> {
        if (this.isDevelopment) {
            // 开发模式：尝试连接到 Vite 开发服务器
            const devServerUrl = 'http://localhost:5173';
            const isAvailable = await this.checkDevServer(devServerUrl);

            if (isAvailable) {
                this.logService.info('OpenWork dev server detected, using hot reload');
                return devServerUrl;
            } else {
                this.logService.warn('OpenWork dev server not running, using built files');
            }
        }

        // 生产模式：加载打包后的文件
        const distPath = path.join(
            this.environmentService.appRoot,
            'out',
            'openwork',
            'dist',
            'index.html'
        );
        return `file://${distPath}`;
    }

    private async checkDevServer(url: string): Promise<boolean> {
        try {
            const response = await fetch(url);
            return response.ok;
        } catch {
            return false;
        }
    }

    private getIconPath(): string {
        return path.join(
            this.environmentService.appRoot,
            'extensions',
            'openwork-dev',
            'openwork-logo-transparent.svg'
        );
    }

    private getPreloadPath(): string {
        return path.join(
            this.environmentService.appRoot,
            'out',
            'openwork',
            'preload.js'
        );
    }
}
```

### 2.2 WindowsMainService 扩展

**修改位置**：`src/vs/platform/windows/electron-main/windowsMainService.ts`

**新增方法**：

```typescript
// test-workbench_change start
async openOpenWorkWindow(): Promise<void> {
    this.logService.trace('windowsManager#openOpenWorkWindow');

    // 获取或创建 OpenWorkWindowManager
    if (!this.openworkWindowManager) {
        this.openworkWindowManager = this.instantiationService.createInstance(
            OpenWorkWindowManager
        );
    }

    // 打开窗口
    await this.openworkWindowManager.openWindow();
}
// test-workbench_change end
```

### 2.3 命令行参数处理

**修改位置**：`src/vs/platform/launch/electron-main/launchMainService.ts`

**新增逻辑**：

```typescript
// test-workbench_change start
// OpenWork window
if (args['openwork']) {
    await this.windowsMainService.openOpenWorkWindow();
    return;
}
// test-workbench_change end
```

### 2.4 命令面板命令

**新增文件**：`src/vs/openwork/browser/openwork.contribution.ts`

```typescript
// test-workbench_change - new file
import { localize } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { INativeHostService } from '../../../platform/native/common/native.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';

export class OpenOpenWorkWindowAction extends Action2 {
    constructor() {
        super({
            id: 'workbench.action.openOpenWorkWindow',
            title: localize('openOpenWorkWindow', "Open OpenWork Window"),
            category: localize('openwork', "OpenWork"),
            f1: true // 显示在命令面板
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const nativeHostService = accessor.get(INativeHostService);
        await nativeHostService.openOpenWorkWindow();
    }
}

// 注册命令
registerAction2(OpenOpenWorkWindowAction);
```

### 2.5 状态栏按钮（可选）

**新增文件**：`src/vs/openwork/browser/openworkStatusbarItem.ts`

```typescript
// test-workbench_change - new file
import { Disposable } from '../../../base/common/lifecycle.js';
import { IStatusbarService, StatusbarAlignment } from '../../../workbench/services/statusbar/browser/statusbar.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';

export class OpenWorkStatusbarItem extends Disposable {
    constructor(
        @IStatusbarService private readonly statusbarService: IStatusbarService,
        @ICommandService private readonly commandService: ICommandService
    ) {
        super();
        this.registerStatusbarItem();
    }

    private registerStatusbarItem(): void {
        const entry = {
            name: 'OpenWork',
            text: '$(organization) OpenWork',
            tooltip: 'Open OpenWork Window',
            command: 'workbench.action.openOpenWorkWindow',
            ariaLabel: 'Open OpenWork Window'
        };

        this._register(
            this.statusbarService.addEntry(
                entry,
                'openwork.statusbar',
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
Gulp 任务: build-openwork
    ↓
1. 检查 OpenWork 依赖
    ↓
2. 运行 OpenWork Web 应用构建
   (cd extensions/openwork-dev && pnpm run build:ui)
    ↓
3. 复制构建产物
   extensions/openwork-dev/apps/app/dist/ → out/openwork/dist/
    ↓
4. 复制资源文件
   extensions/openwork-dev/*.svg → out/openwork/resources/
    ↓
VS Code 构建完成
```

### 3.2 Gulp 任务定义

**新增文件**：`build/gulpfile.openwork.js`

```javascript
// test-workbench_change - new file
const gulp = require('gulp');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs-extra');

const OPENWORK_ROOT = path.join(__dirname, '..', 'extensions', 'openwork-dev');
const OUT_DIR = path.join(__dirname, '..', 'out', 'openwork');

// 构建 OpenWork
gulp.task('build-openwork', async () => {
    console.log('Building OpenWork...');

    // 检查 OpenWork 目录
    if (!fs.existsSync(OPENWORK_ROOT)) {
        throw new Error('OpenWork directory not found');
    }

    // 安装依赖（如果需要）
    if (!fs.existsSync(path.join(OPENWORK_ROOT, 'node_modules'))) {
        console.log('Installing OpenWork dependencies...');
        await runCommand('pnpm', ['install'], OPENWORK_ROOT);
    }

    // 运行 Web 应用构建
    console.log('Running OpenWork Web build...');
    await runCommand('pnpm', ['run', 'build:ui'], OPENWORK_ROOT);

    // 复制构建产物
    console.log('Copying OpenWork build artifacts...');
    await fs.ensureDir(OUT_DIR);

    const appDistPath = path.join(OPENWORK_ROOT, 'apps', 'app', 'dist');
    if (fs.existsSync(appDistPath)) {
        await fs.copy(appDistPath, path.join(OUT_DIR, 'dist'));
    } else {
        throw new Error('OpenWork build output not found');
    }

    // 复制资源文件
    await fs.ensureDir(path.join(OUT_DIR, 'resources'));
    const logoPath = path.join(OPENWORK_ROOT, 'openwork-logo-transparent.svg');
    if (fs.existsSync(logoPath)) {
        await fs.copy(logoPath, path.join(OUT_DIR, 'resources', 'app.svg'));
    }

    console.log('OpenWork build complete!');
});

// 清理 OpenWork 构建产物
gulp.task('clean-openwork', async () => {
    await fs.remove(OUT_DIR);
    await fs.remove(path.join(OPENWORK_ROOT, 'apps', 'app', 'dist'));
});

// 开发模式：监听 OpenWork 变化
gulp.task('watch-openwork', () => {
    console.log('Watching OpenWork for changes...');
    console.log('Note: OpenWork should be running in dev mode separately');
    console.log('Run: cd extensions/openwork-dev && pnpm run dev:ui');
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
// test-workbench_change start
// 导入 OpenWork 构建任务
require('./gulpfile.openwork');

// 将 OpenWork 构建添加到主构建流程
gulp.task('vscode-darwin-min', gulp.series(
    'build-openwork',  // 新增
    'minify-vscode',
    // ... 其他任务
));

gulp.task('vscode-win32-min', gulp.series(
    'build-openwork',  // 新增
    'minify-vscode',
    // ... 其他任务
));

gulp.task('vscode-linux-min', gulp.series(
    'build-openwork',  // 新增
    'minify-vscode',
    // ... 其他任务
));
// test-workbench_change end
```

## 4. 开发模式设计

### 4.1 开发工作流

```
终端 1: VS Code 开发
$ cd test-workbench-vscode
$ ./scripts/code.sh

终端 2: OpenWork Web 应用开发
$ cd extensions/openwork-dev
$ pnpm run dev:ui

结果:
- VS Code 运行在调试模式
- OpenWork Web 应用运行在 localhost:5173
- VS Code 的 OpenWork 窗口加载 localhost:5173
- 支持热重载
```

### 4.2 环境检测

在 OpenWorkWindowManager 的 `getLoadUrl()` 方法中已实现开发服务器检测。

## 5. 性能优化设计

### 5.1 延迟加载

```typescript
// 只在需要时创建 OpenWorkWindowManager
private _openworkWindowManager: OpenWorkWindowManager | null = null;

get openworkWindowManager(): OpenWorkWindowManager {
    if (!this._openworkWindowManager) {
        this._openworkWindowManager = this.instantiationService.createInstance(
            OpenWorkWindowManager
        );
    }
    return this._openworkWindowManager;
}
```

### 5.2 构建缓存

在 gulpfile.openwork.js 中可以添加构建缓存检查，避免不必要的重新构建。

## 6. 测试策略

### 6.1 单元测试

```typescript
// tests/openwork/openworkWindowManager.test.ts

describe('OpenWorkWindowManager', () => {
    let manager: OpenWorkWindowManager;

    beforeEach(() => {
        manager = new OpenWorkWindowManager(
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
});
```

## 7. 部署设计

### 7.1 打包配置

```json
{
  "scripts": {
    "build": "gulp vscode-darwin-min && gulp build-openwork",
    "build:win": "gulp vscode-win32-min && gulp build-openwork",
    "build:linux": "gulp vscode-linux-min && gulp build-openwork"
  }
}
```

## 8. 关键差异说明

### 8.1 与 AionUI 集成的差异

1. **构建工具**：OpenWork 使用 pnpm，AionUI 使用 bun
2. **应用类型**：OpenWork 是 monorepo，需要构建 apps/app 子项目
3. **构建命令**：使用 `pnpm run build:ui` 而不是 `bun run package`
4. **产物路径**：从 `apps/app/dist/` 复制而不是 `out/`

### 8.2 Tauri 适配说明

OpenWork 原本是 Tauri 应用，但我们集成的是其 Web 应用部分（apps/app），这是一个标准的 SolidJS + Vite 应用，可以直接在 Electron 的 BrowserWindow 中运行。

Tauri 桌面应用（apps/desktop）保持独立，不影响集成。

# OpenWork 集成总结

## 🎯 集成目标

将 `/Users/lujs/test-workbench-vscode/extensions/openwork-dev` 集成到 VS Code 中，参考 `aionui-integration` 的实现方式。

## 📊 关键信息

### OpenWork 项目结构

```
extensions/openwork-dev/
├── apps/
│   ├── app/              # Web 应用（我们要集成的部分）
│   ├── desktop/          # Tauri 桌面应用（保持独立）
│   └── ...
├── packages/
├── package.json          # 使用 pnpm workspace
└── pnpm-workspace.yaml
```

### 集成方式

- **类型**：独立 Electron 窗口（与 AionUI 相同）
- **加载内容**：OpenWork Web 应用（apps/app）
- **构建工具**：pnpm（不同于 AionUI 的 bun）
- **框架**：SolidJS + Vite（原本是 Tauri 应用）

## 🔄 与 AionUI 集成的对比

| 项目 | AionUI | OpenWork |
|------|--------|----------|
| **位置** | `extensions/aionui-main/` | `extensions/openwork-dev/` |
| **包管理器** | bun | pnpm |
| **项目类型** | 单体应用 | monorepo |
| **构建命令** | `bun run package` | `pnpm run build:ui` |
| **开发命令** | `bun run start` | `pnpm run dev:ui` |
| **产物路径** | `out/` | `apps/app/dist/` |
| **原始框架** | Electron + React | Tauri + SolidJS |
| **窗口尺寸** | 1200x800 | 1400x900 |
| **命令参数** | `--aionui` | `--openwork` |
| **命令 ID** | `workbench.action.openAionUIWindow` | `workbench.action.openOpenWorkWindow` |

## 📁 需要创建的文件

### 1. VS Code 集成代码

```
src/vs/openwork/
├── electron-main/
│   ├── openworkWindowManager.ts    # 窗口管理器（核心）
│   └── openworkMain.ts             # 主进程入口
├── common/
│   ├── openwork.ts                 # 常量定义
│   └── openworkIpc.ts              # IPC 协议（可选）
└── browser/
    ├── openwork.contribution.ts    # 命令注册
    └── openworkStatusbarItem.ts    # 状态栏按钮（可选）
```

### 2. 构建脚本

```
build/
└── gulpfile.openwork.js            # OpenWork 构建任务
```

### 3. 输出目录

```
out/openwork/
├── dist/                           # Web 应用构建产物
└── resources/                      # 图标等资源
```

## 🔧 需要修改的文件

### 1. WindowsMainService

**文件**：`src/vs/platform/windows/electron-main/windowsMainService.ts`

**修改**：
```typescript
// test-workbench_change start
import { OpenWorkWindowManager } from '../../openwork/electron-main/openworkWindowManager.js';

private openworkWindowManager: OpenWorkWindowManager | null = null;

async openOpenWorkWindow(): Promise<void> {
    // ... 实现
}
// test-workbench_change end
```

### 2. LaunchMainService

**文件**：`src/vs/platform/launch/electron-main/launchMainService.ts`

**修改**：
```typescript
// test-workbench_change start
if (args['openwork']) {
    await this.windowsMainService.openOpenWorkWindow();
    return;
}
// test-workbench_change end
```

### 3. 主构建文件

**文件**：`build/gulpfile.vscode.js`

**修改**：
```javascript
// test-workbench_change start
require('./gulpfile.openwork');

// 在各平台构建任务中添加 'build-openwork'
// test-workbench_change end
```

## 🚀 实施流程

### 阶段 1: 准备工作（30 分钟）

1. 验证 OpenWork 可以独立运行
   ```bash
   cd extensions/openwork-dev
   pnpm install
   pnpm run dev:ui  # 应该打开 http://localhost:5173
   ```

2. 创建目录结构
   ```bash
   mkdir -p src/vs/openwork/{electron-main,common,browser}
   ```

### 阶段 2: 核心实现（2-3 小时）

1. 实现 `OpenWorkWindowManager`（参考 AionUI）
2. 修改 `WindowsMainService`
3. 修改 `LaunchMainService`
4. 实现命令面板命令

### 阶段 3: 构建集成（1-2 小时）

1. 创建 `gulpfile.openwork.js`
2. 集成到主构建流程
3. 测试构建

### 阶段 4: 测试验证（1 小时）

1. 开发模式测试
2. 生产构建测试
3. 功能验证

## 📝 关键实现细节

### 1. 窗口管理器核心逻辑

```typescript
// 开发模式：加载 http://localhost:5173
// 生产模式：加载 file:///.../out/openwork/dist/index.html

private async getLoadUrl(): Promise<string> {
    if (this.isDevelopment) {
        const devServerUrl = 'http://localhost:5173';
        const isAvailable = await this.checkDevServer(devServerUrl);
        if (isAvailable) {
            return devServerUrl;
        }
    }
    return `file://${distPath}`;
}
```

### 2. 构建脚本核心逻辑

```javascript
// 1. 安装依赖（如果需要）
await runCommand('pnpm', ['install'], OPENWORK_ROOT);

// 2. 构建 Web 应用
await runCommand('pnpm', ['run', 'build:ui'], OPENWORK_ROOT);

// 3. 复制产物
await fs.copy(
    path.join(OPENWORK_ROOT, 'apps', 'app', 'dist'),
    path.join(OUT_DIR, 'dist')
);
```

### 3. 单例模式实现

```typescript
async openWindow(): Promise<void> {
    // 如果窗口已存在，聚焦它
    if (this.window && !this.window.isDestroyed()) {
        this.window.focus();
        return;
    }
    // 否则创建新窗口
    await this.createWindow();
}
```

## ✅ 验收标准

### 功能验收

- [ ] 可以通过 `code --openwork` 启动
- [ ] 可以通过命令面板启动
- [ ] 窗口独立运行
- [ ] 单例模式工作正常
- [ ] 开发模式热重载工作
- [ ] 生产构建正常

### 性能验收

- [ ] 启动时间 < 3 秒
- [ ] 内存占用 < 600MB
- [ ] 不影响 VS Code 性能

## 🎓 学习资源

### 参考实现

1. **AionUI 集成**：`.kiro/specs/aionui-integration/`
   - 完整的实现示例
   - 可以直接参考和复用大部分代码

2. **VS Code Sessions 模块**：`src/vs/sessions/`
   - VS Code 官方的独立窗口实现
   - 了解 VS Code 的窗口管理机制

### 关键文件

```
参考这些文件了解实现细节：
- src/vs/aionui/electron-main/aionuiWindowManager.ts
- build/gulpfile.aionui.js
- src/vs/platform/windows/electron-main/windowsMainService.ts
```

## 🐛 预期问题和解决方案

### 问题 1: Tauri 到 Electron 的适配

**解决**：使用 OpenWork 的 Web 应用部分（apps/app），这是标准的 SolidJS + Vite 应用，可以直接在 Electron 中运行。

### 问题 2: pnpm workspace 构建

**解决**：使用 `pnpm run build:ui` 命令，它会自动处理 workspace 依赖。

### 问题 3: 构建产物路径

**解决**：从 `apps/app/dist/` 复制，而不是根目录的 `out/`。

## 📞 获取帮助

1. **查看文档**：
   - [需求文档](./requirements.md)
   - [设计文档](./design.md)
   - [快速开始](./QUICK_START.md)

2. **参考实现**：
   - AionUI 集成代码
   - VS Code Sessions 模块

3. **调试技巧**：
   - 使用 VS Code DevTools
   - 查看主进程日志
   - 查看构建日志

## 🎉 完成后的效果

完成集成后，你将能够：

1. 在 VS Code 中通过命令打开 OpenWork
2. OpenWork 在独立窗口中运行
3. 开发时支持热重载
4. 生产构建包含 OpenWork
5. 保持 OpenWork 的独立开发能力

---

**准备好开始了吗？**

1. 先阅读 [快速开始指南](./QUICK_START.md)
2. 参考 [设计文档](./design.md) 了解详细实现
3. 参考 AionUI 的代码进行实现

**祝你成功！** 🚀

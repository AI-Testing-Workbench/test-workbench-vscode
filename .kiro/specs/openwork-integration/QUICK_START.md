# OpenWork 集成快速开始指南

本指南将帮助你快速完成 OpenWork 到 VS Code 的集成，参考 aionui-integration 的实现模式。

## 📋 前置条件检查

### 1. 环境要求

```bash
# Node.js 版本
node --version  # 应该 >= 22

# pnpm 版本
pnpm --version  # 应该 >= 10

# 检查 VS Code 源码
ls -la /Users/lujs/test-workbench-vscode

# 检查 OpenWork 源码
ls -la /Users/lujs/test-workbench-vscode/extensions/openwork-dev
```

### 2. 验证 OpenWork 独立运行

```bash
cd /Users/lujs/test-workbench-vscode/extensions/openwork-dev

# 安装依赖
pnpm install

# 启动 Web 应用开发服务器
pnpm run dev:ui

# 应该能在浏览器中打开 http://localhost:5173
# 看到 OpenWork 的界面
```

### 3. 验证 VS Code 可以构建

```bash
cd /Users/lujs/test-workbench-vscode

# 安装依赖
npm install

# 运行开发模式
./scripts/code.sh

# 应该能启动 VS Code
```

## 🚀 实施步骤

### 步骤 1: 创建集成代码目录结构

```bash
cd /Users/lujs/test-workbench-vscode

# 创建 OpenWork 集成目录
mkdir -p src/vs/openwork/electron-main
mkdir -p src/vs/openwork/common
mkdir -p src/vs/openwork/browser
```

### 步骤 2: 实现 OpenWorkWindowManager

创建文件 `src/vs/openwork/electron-main/openworkWindowManager.ts`，参考设计文档中的实现。

关键点：
- 使用 BrowserWindow 创建独立窗口
- 实现单例模式
- 支持开发模式和生产模式
- 窗口尺寸：1400x900，最小 1024x768

### 步骤 3: 集成到 WindowsMainService

修改 `src/vs/platform/windows/electron-main/windowsMainService.ts`：

```typescript
// test-workbench_change start
import { OpenWorkWindowManager } from '../../openwork/electron-main/openworkWindowManager.js';

// 在类中添加属性
private openworkWindowManager: OpenWorkWindowManager | null = null;

// 添加方法
async openOpenWorkWindow(): Promise<void> {
    this.logService.trace('windowsManager#openOpenWorkWindow');

    if (!this.openworkWindowManager) {
        this.openworkWindowManager = this.instantiationService.createInstance(
            OpenWorkWindowManager
        );
    }

    await this.openworkWindowManager.openWindow();
}
// test-workbench_change end
```

### 步骤 4: 添加命令行参数支持

修改 `src/vs/platform/launch/electron-main/launchMainService.ts`：

```typescript
// test-workbench_change start
// OpenWork window
if (args['openwork']) {
    await this.windowsMainService.openOpenWorkWindow();
    return;
}
// test-workbench_change end
```

### 步骤 5: 添加命令面板命令

创建文件 `src/vs/openwork/browser/openwork.contribution.ts`，实现命令注册。

命令 ID: `workbench.action.openOpenWorkWindow`

### 步骤 6: 创建构建脚本

创建文件 `build/gulpfile.openwork.js`，参考设计文档中的实现。

关键点：
- 使用 pnpm 安装依赖
- 运行 `pnpm run build:ui` 构建 Web 应用
- 从 `apps/app/dist/` 复制产物到 `out/openwork/dist/`
- 复制图标资源

### 步骤 7: 集成到主构建流程

修改 `build/gulpfile.vscode.js`，添加 OpenWork 构建任务：

```javascript
// test-workbench_change start
require('./gulpfile.openwork');

// 在各平台构建任务中添加 'build-openwork'
// test-workbench_change end
```

### 步骤 8: 测试

#### 开发模式测试

```bash
# 终端 1: 启动 OpenWork 开发服务器
cd extensions/openwork-dev
pnpm run dev:ui

# 终端 2: 启动 VS Code
cd /Users/lujs/test-workbench-vscode
./scripts/code.sh

# 在 VS Code 中测试
# 1. 命令面板 > Open OpenWork Window
# 2. 应该打开 OpenWork 窗口，显示 http://localhost:5173 的内容
```

#### 生产构建测试

```bash
# 构建 OpenWork
gulp build-openwork

# 检查产物
ls -la out/openwork/dist/

# 启动 VS Code（生产模式）
# 命令面板 > Open OpenWork Window
# 应该加载本地构建的文件
```

## 📝 实施检查清单

### 代码实现

- [ ] 创建 `src/vs/openwork/` 目录结构
- [ ] 实现 `OpenWorkWindowManager`
- [ ] 修改 `WindowsMainService`
- [ ] 修改 `LaunchMainService`
- [ ] 实现命令面板命令
- [ ] 创建构建脚本

### 构建配置

- [ ] 创建 `gulpfile.openwork.js`
- [ ] 集成到主构建流程
- [ ] 测试独立构建
- [ ] 测试完整构建

### 功能测试

- [ ] 命令行启动：`code --openwork`
- [ ] 命令面板启动
- [ ] 窗口单例模式
- [ ] 开发模式热重载
- [ ] 生产模式加载

### 跨平台测试

- [ ] macOS 测试
- [ ] Windows 测试（如果可用）
- [ ] Linux 测试（如果可用）

## 🐛 常见问题

### Q1: OpenWork 开发服务器启动失败

**症状**：运行 `pnpm run dev:ui` 报错

**解决**：
```bash
# 清理依赖重新安装
cd extensions/openwork-dev
rm -rf node_modules
pnpm install

# 检查端口是否被占用
lsof -i :5173
```

### Q2: VS Code 找不到 OpenWork 窗口管理器

**症状**：运行时报错找不到模块

**解决**：
- 检查文件路径是否正确
- 检查 import 语句是否正确
- 重新编译 VS Code

### Q3: 构建产物路径不对

**症状**：生产模式下窗口加载失败

**解决**：
```bash
# 检查构建产物
ls -la out/openwork/dist/

# 检查 OpenWork 构建输出
ls -la extensions/openwork-dev/apps/app/dist/

# 重新构建
gulp clean-openwork
gulp build-openwork
```

### Q4: 窗口显示空白

**症状**：窗口打开但内容为空

**解决**：
- 开发模式：确保 `pnpm run dev:ui` 正在运行
- 生产模式：确保构建产物存在
- 打开 DevTools 查看控制台错误
- 检查 URL 是否正确

## 📚 参考实现

### 参考 AionUI 集成

OpenWork 集成与 AionUI 集成非常相似，主要差异：

| 特性 | AionUI | OpenWork |
|------|--------|----------|
| 包管理器 | bun | pnpm |
| 构建命令 | `bun run package` | `pnpm run build:ui` |
| 产物路径 | `out/` | `apps/app/dist/` |
| 窗口尺寸 | 1200x800 | 1400x900 |

### 关键文件对比

```
AionUI:
- src/vs/aionui/electron-main/aionuiWindowManager.ts
- build/gulpfile.aionui.js

OpenWork:
- src/vs/openwork/electron-main/openworkWindowManager.ts
- build/gulpfile.openwork.js
```

可以直接参考 AionUI 的实现，替换相应的名称和路径。

## 🎯 下一步

完成基础集成后，可以考虑：

1. **添加状态栏按钮**：方便快速打开
2. **实现 IPC 通信**：支持 VS Code 与 OpenWork 交互
3. **优化性能**：添加窗口预加载、构建缓存等
4. **完善文档**：添加用户指南和 API 文档

## 💡 提示

- 所有修改都要添加 `test-workbench_change` 标记
- 保持代码简洁，参考 AionUI 的实现
- 遇到问题先查看 AionUI 是如何实现的
- 充分利用 VS Code 的依赖注入系统

---

**准备好了吗？** 开始实施吧！如有问题，参考 [设计文档](./design.md) 或 AionUI 的实现。

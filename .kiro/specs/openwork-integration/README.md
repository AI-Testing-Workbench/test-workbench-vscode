# OpenWork 集成到 VS Code - 项目文档

## 📋 项目概述

本项目旨在将 OpenWork（一个基于 Tauri + SolidJS 的协作工作平台）集成到 VS Code 源码中，使其能够通过命令独立弹出，参考 `aionui-integration` 的架构模式。

### 核心目标

- ✅ **独立性**：OpenWork 保持完全独立，不依赖 VS Code UI 组件
- ✅ **可维护性**：OpenWork 可以独立开发和构建
- ✅ **集成性**：通过 VS Code 命令/按钮唤起
- ✅ **简单性**：采用独立 Electron 窗口方式，实现简单快速

### 技术方案

采用 **独立 Electron 窗口** 方式：
- 在 VS Code 主进程中创建独立的 BrowserWindow
- 加载 OpenWork Web 应用的构建产物或开发服务器
- 通过 IPC 实现可选的通信功能

## 📚 文档结构

### 核心文档

1. **[需求文档](./requirements.md)** - 详细的功能和非功能需求
2. **[设计文档](./design.md)** - 完整的技术设计
3. **[快速开始](./QUICK_START.md)** - 快速上手指南
4. **[打包指南](./PACKAGE_DMG.md)** - macOS DMG 打包完整指南
5. **[故障排查](./TROUBLESHOOTING.md)** - 所有问题及解决方案汇总
6. **[构建状态](./BUILD_STATUS.md)** - 最新构建状态和验证

## 🚀 快速开始

### 1. 前置条件

```bash
# 检查环境
node --version  # >= 22
pnpm --version  # >= 10

# 验证 OpenWork 可以独立构建
cd extensions/openwork-dev
pnpm install
pnpm run dev:ui   # 应该能打开 http://localhost:5173
```

### 2. 实施步骤

参考 aionui-integration 的实现，按照以下步骤进行：

1. 创建 VS Code 集成代码结构
2. 实现 OpenWorkWindowManager
3. 集成到 WindowsMainService
4. 添加命令支持
5. 配置构建流程
6. 测试运行

## 🏗️ 架构概览

```
VS Code 主进程
    ↓
WindowsMainService.openOpenWorkWindow()
    ↓
OpenWorkWindowManager
    ↓
Electron BrowserWindow
    ↓
OpenWork Web 应用（独立运行）
```

### 目录结构

```
test-workbench-vscode/
├── extensions/openwork-dev/         # OpenWork 源码（保持不变）
│   ├── apps/app/                    # Web 应用（用于集成）
│   └── ...
├── src/vs/openwork/                 # VS Code 集成代码（新增）
│   ├── electron-main/               # 主进程代码
│   ├── common/                      # 公共代码
│   └── browser/                     # 渲染进程代码
├── build/gulpfile.openwork.js       # 构建脚本（新增）
└── out/openwork/                    # 构建产物
```

## 🎯 核心功能

### 启动方式

1. **命令行**：`code --openwork`
2. **命令面板**：`Open OpenWork Window`
3. **状态栏按钮**（可选）：点击 OpenWork 图标

### 窗口特性

- 独立的 Electron 窗口
- 单例模式（同时只能打开一个）
- 支持最小化、最大化、关闭
- 开发模式支持热重载

### 构建集成

- OpenWork 保留独立构建能力
- VS Code 构建时自动构建 OpenWork Web 应用
- 开发模式和生产模式自动切换

## 🔧 开发工作流

### 开发模式

```bash
# 终端 1: 启动 OpenWork Web 应用开发服务器
cd extensions/openwork-dev
pnpm run dev:ui

# 终端 2: 启动 VS Code 开发模式
cd /Users/lujs/test-workbench-vscode
./scripts/code.sh

# 在 VS Code 中打开 OpenWork
# 命令面板 > Open OpenWork Window
```

### 生产构建

```bash
# 完整构建（包含 OpenWork）
gulp vscode-darwin-min

# 只构建 OpenWork
gulp build-openwork

# 清理 OpenWork 构建产物
gulp clean-openwork
```

## 📊 关键差异

### 与 AionUI 集成的差异

| 特性 | AionUI | OpenWork |
|------|--------|----------|
| 构建工具 | bun | pnpm |
| 应用类型 | 单体应用 | monorepo (apps/app) |
| 构建命令 | `bun run package` | `pnpm run build:ui` |
| 产物路径 | `out/` | `apps/app/dist/` |
| 原始框架 | Electron + React | Tauri + SolidJS |

### Tauri 适配说明

OpenWork 原本是 Tauri 应用，但我们集成的是其 Web 应用部分（apps/app），这是一个标准的 SolidJS + Vite 应用，可以直接在 Electron 的 BrowserWindow 中运行。

Tauri 桌面应用（apps/desktop）保持独立，不影响集成。

## ⚠️ 注意事项

### 重要约束

1. **不修改 OpenWork 核心代码**
   - 保持 OpenWork 的独立性
   - 所有集成代码在 `src/vs/openwork/`

2. **最小化对 VS Code 的修改**
   - 只修改必要的集成点
   - 使用 test-workbench_change 标记

3. **保持构建系统独立**
   - OpenWork 使用 pnpm + Vite
   - VS Code 使用 npm + Gulp
   - 通过脚本桥接

### 已知风险

1. **Tauri 到 Electron 的适配**（中风险）
   - 缓解：使用 Web 应用部分，标准 Web 技术

2. **构建系统冲突**（中风险）
   - 缓解：保持独立，脚本桥接

3. **依赖冲突**（低风险）
   - 缓解：保持依赖隔离

## 🐛 故障排查

遇到问题？请查看 **[完整故障排查指南](./TROUBLESHOOTING.md)**，其中包含：

- ✅ TypeScript 编译错误的解决方案
- ✅ 文件协议加载失败的修复方法
- ✅ 资源路径问题的配置指南
- ✅ 打包文件缺失的完整解决流程
- ✅ 模块导入错误的根本原因和修复
- ✅ 所有问题的详细分析和最佳实践

### 快速诊断

1. **窗口打不开**
   - 检查开发服务器是否运行（pnpm run dev:ui）
   - 检查构建产物是否存在
   - 查看 VS Code 日志
   - 参考：[故障排查 - 文件协议加载失败](./TROUBLESHOOTING.md#2-文件协议加载失败)

2. **构建失败**
   - 检查 pnpm 是否安装
   - 检查依赖是否安装
   - 查看构建日志
   - 参考：[故障排查 - TypeScript 编译错误](./TROUBLESHOOTING.md#1-typescript-编译错误)

3. **打包后无法启动**
   - 检查文件是否完整打包
   - 验证模块导入路径
   - 参考：[故障排查 - 打包文件缺失](./TROUBLESHOOTING.md#4-打包文件缺失)和[模块导入错误](./TROUBLESHOOTING.md#5-模块导入错误)

## 📞 参考资料

### 相关文档

- [AionUI 集成文档](../aionui-integration/README.md)
- [VS Code 源码](https://github.com/microsoft/vscode)
- [OpenWork GitHub](https://github.com/different-ai/openwork)

### 技术文档

- [Electron 文档](https://www.electronjs.org/docs)
- [SolidJS 文档](https://www.solidjs.com/)
- [Vite 文档](https://vitejs.dev/)

## 🎉 成功标准

项目成功的标志：

✅ 可以通过命令行和命令面板启动 OpenWork
✅ OpenWork 窗口独立运行，功能完整
✅ 开发模式支持热重载
✅ 生产构建正常工作
✅ 跨平台兼容

---

**开始开发**：请参考 [设计文档](./design.md) 开始实施！

**问题反馈**：如有问题，请查看文档或参考 aionui-integration 的实现。

**祝开发顺利！** 🚀

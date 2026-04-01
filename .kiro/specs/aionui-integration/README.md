# AionUI 集成到 VS Code - 项目文档

## 📋 项目概述

本项目旨在将 AionUI（一个完整的 Electron + React AI 聊天应用）集成到 VS Code 源码中，使其能够通过命令独立弹出，参考 `vs/sessions` 模块的架构模式。

### 核心目标

- ✅ **独立性**：AionUI 保持完全独立，不依赖 VS Code UI 组件
- ✅ **可维护性**：AionUI 可以独立开发和构建
- ✅ **集成性**：通过 VS Code 命令/按钮唤起
- ✅ **简单性**：采用独立 Electron 窗口方式，实现简单快速

### 技术方案

采用 **独立 Electron 窗口** 方式（选项 A）：
- 在 VS Code 主进程中创建独立的 BrowserWindow
- 加载 AionUI 的构建产物或开发服务器
- 通过 IPC 实现可选的通信功能

## 📚 文档结构

### 核心文档

1. **[需求文档](./requirements.md)** - 详细的功能和非功能需求
   - 启动方式（命令行、命令面板、状态栏）
   - 窗口行为（独立窗口、单例模式）
   - 构建集成（独立构建、VS Code 集成）
   - 通信能力（IPC 协议）

2. **[设计文档](./design.md)** - 完整的技术设计
   - 架构设计（整体架构、目录结构）
   - 核心组件设计（WindowManager、命令、构建）
   - IPC 通信设计
   - 性能优化设计

3. **[任务列表](./tasks.md)** - 详细的实施任务
   - 8 个阶段，50+ 个任务
   - 预计 5.5 天完成
   - 包含验收标准和风险评估

4. **[快速开始](./QUICK_START.md)** - 快速上手指南
   - 前置条件检查
   - 最小可行实现
   - 常见问题解答

## 🚀 快速开始

### 1. 前置条件

```bash
# 检查环境
node --version  # >= 22
bun --version   # 最新版本

# 验证 AionUI 可以独立构建
cd extensions/aionui-main
bun install
bun run start   # 应该能打开 http://localhost:5173
```

### 2. 最小实现（30 分钟）

按照 [快速开始指南](./QUICK_START.md) 完成：

1. 创建目录结构
2. 实现 AionUIWindowManager
3. 集成到 WindowsMainService
4. 添加命令支持
5. 测试运行

### 3. 完整实现（5.5 天）

按照 [任务列表](./tasks.md) 完成所有阶段。

## 🏗️ 架构概览

```
VS Code 主进程
    ↓
WindowsMainService.openAionUIWindow()
    ↓
AionUIWindowManager
    ↓
Electron BrowserWindow
    ↓
AionUI 应用（独立运行）
```

### 目录结构

```
test-workbench-vscode/
├── extensions/aionui-main/          # AionUI 源码（保持不变）
├── src/vs/aionui/                   # VS Code 集成代码（新增）
│   ├── electron-main/               # 主进程代码
│   ├── common/                      # 公共代码
│   └── browser/                     # 渲染进程代码
├── build/gulpfile.aionui.js         # 构建脚本（新增）
└── out/aionui/                      # 构建产物
```

## 🎯 核心功能

### 启动方式

1. **命令行**：`code --aionui`
2. **命令面板**：`Open AionUI Window`
3. **状态栏按钮**（可选）：点击 AionUI 图标

### 窗口特性

- 独立的 Electron 窗口
- 单例模式（同时只能打开一个）
- 支持最小化、最大化、关闭
- 开发模式支持热重载

### 构建集成

- AionUI 保留独立构建能力
- VS Code 构建时自动构建 AionUI
- 开发模式和生产模式自动切换

## 📊 项目进度

### 当前状态

- [x] 需求分析完成
- [x] 技术设计完成
- [x] 任务规划完成
- [ ] 开发实施（待开始）

### 里程碑

| 里程碑 | 预计完成时间 | 状态 |
|--------|-------------|------|
| M1: 最小可行实现 | Day 1 | 🔄 进行中 |
| M2: 命令集成完成 | Day 1.5 | ⏳ 待开始 |
| M3: 构建集成完成 | Day 2.5 | ⏳ 待开始 |
| M4: 测试完成 | Day 3.5 | ⏳ 待开始 |
| M5: 文档完成 | Day 4 | ⏳ 待开始 |
| M6: 发布就绪 | Day 5.5 | ⏳ 待开始 |

## 🔧 开发工作流

### 开发模式

```bash
# 终端 1: 启动 AionUI 开发服务器
cd extensions/aionui-main
bun run start

# 终端 2: 启动 VS Code 开发模式
cd /Users/lujs/test-workbench-vscode
./scripts/code.sh

# 在 VS Code 中打开 AionUI
# 命令面板 > Open AionUI Window
```

### 生产构建

```bash
# 完整构建（包含 AionUI）
gulp vscode-darwin-min

# 只构建 AionUI
gulp build-aionui

# 清理 AionUI 构建产物
gulp clean-aionui
```

## 🧪 测试策略

### 测试层级

1. **单元测试**：核心组件逻辑
2. **集成测试**：VS Code 集成点
3. **E2E 测试**：完整用户流程
4. **手动测试**：跨平台验证

### 测试覆盖

- [ ] AionUIWindowManager 单元测试
- [ ] 命令集成测试
- [ ] 构建流程测试
- [ ] IPC 通信测试
- [ ] 跨平台测试（macOS, Windows, Linux）

## 📖 参考资料

### VS Code 相关

- [VS Code 源码](https://github.com/microsoft/vscode)
- [VS Code Sessions 模块](../../../src/vs/sessions/)
- [VS Code 架构文档](../../../docs/)

### AionUI 相关

- [AionUI GitHub](https://github.com/iOfficeAI/AionUi)
- [AionUI 文档](../../../extensions/aionui-main/readme.md)

### Electron 相关

- [Electron 文档](https://www.electronjs.org/docs)
- [BrowserWindow API](https://www.electronjs.org/docs/api/browser-window)
- [IPC 通信](https://www.electronjs.org/docs/api/ipc-main)

## 🤝 贡献指南

### 代码规范

1. **遵循 VS Code 代码规范**
2. **添加 test-workbench_change 标记**
   ```typescript
   // test-workbench_change start
   // AionUI integration code
   // test-workbench_change end
   ```
3. **保持代码简洁清晰**
4. **添加必要的注释**

### 提交规范

```bash
# 提交格式
git commit -m "feat(aionui): add window manager"
git commit -m "fix(aionui): fix build script"
git commit -m "docs(aionui): update quick start guide"
```

### 代码审查

- 所有代码需要经过审查
- 确保测试通过
- 确保文档更新

## ⚠️ 注意事项

### 重要约束

1. **不修改 AionUI 核心代码**
   - 保持 AionUI 的独立性
   - 所有集成代码在 `src/vs/aionui/`

2. **最小化对 VS Code 的修改**
   - 只修改必要的集成点
   - 使用 test-workbench_change 标记

3. **保持构建系统独立**
   - AionUI 使用 Vite
   - VS Code 使用 Gulp
   - 通过脚本桥接

### 已知风险

1. **构建系统冲突**（高风险）
   - 缓解：保持独立，脚本桥接

2. **Electron 版本不兼容**（高风险）
   - 缓解：使用 VS Code 的 Electron 版本

3. **依赖冲突**（中风险）
   - 缓解：保持依赖隔离

## 🐛 故障排查

### 常见问题

1. **窗口打不开**
   - 检查开发服务器是否运行
   - 检查构建产物是否存在
   - 查看 VS Code 日志

2. **构建失败**
   - 检查 Bun 是否安装
   - 检查依赖是否安装
   - 查看构建日志

3. **热重载不工作**
   - 确保开发服务器运行
   - 确保 VS Code 在开发模式
   - 检查 URL 配置

详见 [快速开始指南 - 常见问题](./QUICK_START.md#常见问题)

## 📞 获取帮助

### 文档资源

1. 查看本项目文档
2. 查看 VS Code Sessions 模块实现
3. 查看 AionUI 源码

### 调试技巧

1. 使用 VS Code 开发者工具
2. 查看主进程日志
3. 查看渲染进程日志
4. 使用断点调试

## 📝 更新日志

### 2024-01-XX

- ✅ 完成需求分析
- ✅ 完成技术设计
- ✅ 完成任务规划
- ✅ 创建快速开始指南

### 待办事项

- [ ] 实现最小可行版本
- [ ] 完成命令集成
- [ ] 完成构建集成
- [ ] 完成测试
- [ ] 完成文档

## 🎉 成功标准

项目成功的标志：

✅ 可以通过命令行和命令面板启动 AionUI
✅ AionUI 窗口独立运行，功能完整
✅ 开发模式支持热重载
✅ 生产构建正常工作
✅ 所有测试通过
✅ 文档完整准确
✅ 跨平台兼容

## 📄 许可证

本项目遵循 VS Code 和 AionUI 的许可证。

---

**开始开发**：请从 [快速开始指南](./QUICK_START.md) 开始！

**问题反馈**：如有问题，请查看文档或联系团队。

**祝开发顺利！** 🚀

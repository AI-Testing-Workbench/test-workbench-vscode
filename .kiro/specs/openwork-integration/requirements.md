# OpenWork 集成到 VS Code - 需求文档

## 1. 项目概述

### 1.1 目标
将 OpenWork（一个基于 Tauri + SolidJS 的协作工作平台）集成到 VS Code 源码中，使其能够通过命令独立弹出，参考 AionUI 的集成架构。

### 1.2 参考架构
参考 `aionui-integration` 的独立窗口架构，采用 Electron BrowserWindow 方式。

### 1.3 核心原则
- **独立性**：OpenWork 保持完全独立，不依赖 VS Code UI 组件
- **可维护性**：OpenWork 可以独立开发和构建
- **集成性**：通过 VS Code 命令/按钮唤起
- **通信能力**：可选的 IPC 通信支持

## 2. 功能需求

### 2.1 启动方式

#### FR-1: 命令行启动
- **需求**：支持通过命令行参数 `--openwork` 启动
- **示例**：`code --openwork`
- **优先级**：P0（必须）

#### FR-2: 命令面板启动
- **需求**：在 VS Code 命令面板中提供 "Open OpenWork Window" 命令
- **命令 ID**：`workbench.action.openOpenWorkWindow`
- **优先级**：P0（必须）

#### FR-3: 状态栏按钮（可选）
- **需求**：在状态栏添加 OpenWork 图标按钮
- **位置**：状态栏右侧
- **优先级**：P1（建议）

### 2.2 窗口行为

#### FR-4: 独立窗口
- **需求**：OpenWork 在独立的 Electron BrowserWindow 中运行
- **特性**：
  - 独立的窗口进程
  - 可以独立于 VS Code 主窗口存在
  - 支持最小化、最大化、关闭
- **优先级**：P0（必须）

#### FR-5: 窗口配置
- **默认尺寸**：1400x900
- **最小尺寸**：1024x768
- **标题**：OpenWork - Collaborative Workspace
- **图标**：使用 OpenWork 的应用图标
- **优先级**：P0（必须）

#### FR-6: 单例模式
- **需求**：同一时间只能打开一个 OpenWork 窗口
- **行为**：如果已存在窗口，则聚焦现有窗口
- **优先级**：P0（必须）

### 2.3 构建集成

#### FR-7: 独立构建保留
- **需求**：OpenWork 保留独立构建能力
- **位置**：`extensions/openwork-dev/`
- **构建命令**：保持原有的 `pnpm run build` 等命令
- **优先级**：P0（必须）

#### FR-8: VS Code 构建集成
- **需求**：VS Code 构建时自动构建 OpenWork
- **集成点**：
  - 在 VS Code 的 gulp 构建流程中添加 OpenWork 构建步骤
  - 将 OpenWork 构建产物复制到 VS Code 输出目录
- **优先级**：P0（必须）

#### FR-9: 开发模式支持
- **需求**：开发时支持热重载
- **方案**：
  - 开发模式下加载 OpenWork 的开发服务器（localhost:5173）
  - 生产模式下加载打包后的静态文件
- **优先级**：P1（建议）

### 2.4 通信能力（可选）

#### FR-10: 基础 IPC 通信
- **需求**：OpenWork 可以与 VS Code 主进程通信
- **用例**：
  - 获取当前打开的文件路径
  - 获取当前工作区信息
  - 接收 VS Code 事件通知
- **优先级**：P2（可选）

#### FR-11: 文件操作
- **需求**：OpenWork 可以请求 VS Code 打开文件
- **方法**：通过 IPC 调用 VS Code 的文件服务
- **优先级**：P2（可选）

## 3. 非功能需求

### 3.1 性能

#### NFR-1: 启动速度
- **需求**：OpenWork 窗口应在 3 秒内显示
- **优先级**：P1（建议）

#### NFR-2: 内存占用
- **需求**：OpenWork 窗口内存占用不超过 600MB
- **优先级**：P1（建议）

### 3.2 兼容性

#### NFR-3: 平台支持
- **需求**：支持 macOS、Windows、Linux
- **优先级**：P0（必须）

#### NFR-4: VS Code 版本
- **需求**：兼容当前 VS Code 源码版本
- **优先级**：P0（必须）

### 3.3 可维护性

#### NFR-5: 代码隔离
- **需求**：OpenWork 代码与 VS Code 代码清晰分离
- **位置**：
  - OpenWork 源码：`extensions/openwork-dev/`
  - VS Code 集成代码：`src/vs/openwork/`
- **优先级**：P0（必须）

#### NFR-6: 文档完整
- **需求**：提供完整的集成文档
- **内容**：
  - 架构说明
  - 构建指南
  - 开发指南
  - 故障排查
- **优先级**：P0（必须）

## 4. 约束条件

### 4.1 技术约束
- OpenWork 使用 Tauri + SolidJS + Vite + pnpm
- VS Code 使用 Electron + TypeScript + Gulp + npm
- 需要保持两者的构建系统独立
- OpenWork 原本是 Tauri 应用，需要适配为 Electron 窗口

### 4.2 架构约束
- 不修改 OpenWork 的核心代码
- 最小化对 VS Code 核心代码的修改
- 遵循 VS Code 的代码规范和架构模式
- 参考 aionui-integration 的实现模式

### 4.3 兼容性约束
- 不影响 VS Code 的正常功能
- 不影响其他集成模块的运行
- 支持与 VS Code 同时运行

## 5. 验收标准

### 5.1 功能验收
- [ ] 可以通过 `code --openwork` 启动 OpenWork 窗口
- [ ] 可以通过命令面板启动 OpenWork 窗口
- [ ] OpenWork 窗口独立运行，不影响 VS Code 主窗口
- [ ] 只能同时打开一个 OpenWork 窗口
- [ ] OpenWork 的核心功能正常工作

### 5.2 构建验收
- [ ] VS Code 构建时自动构建 OpenWork
- [ ] OpenWork 可以独立构建
- [ ] 开发模式下支持热重载
- [ ] 生产构建正常工作

### 5.3 性能验收
- [ ] OpenWork 窗口启动时间 < 3 秒
- [ ] 内存占用合理（< 600MB）
- [ ] 不影响 VS Code 主窗口性能

### 5.4 兼容性验收
- [ ] 在 macOS 上正常运行
- [ ] 在 Windows 上正常运行
- [ ] 在 Linux 上正常运行

## 6. 风险与缓解

### 6.1 技术风险

#### 风险 1: Tauri 到 Electron 的适配
- **描述**：OpenWork 原本是 Tauri 应用，需要适配为 Electron 窗口
- **影响**：可能需要修改部分代码或配置
- **缓解**：
  - 使用 OpenWork 的 Web 构建产物（apps/app）
  - 在 Electron 窗口中加载 Web 应用
  - 保持 OpenWork 的独立 Tauri 构建能力

#### 风险 2: 构建系统冲突
- **描述**：OpenWork 使用 pnpm + Vite，VS Code 使用 npm + Gulp
- **影响**：可能导致构建失败或产物冲突
- **缓解**：
  - 保持两个构建系统完全独立
  - 使用脚本桥接两个构建流程
  - 明确定义产物输出路径

#### 风险 3: 依赖冲突
- **描述**：OpenWork 和 VS Code 可能有依赖冲突
- **影响**：构建或运行时错误
- **缓解**：
  - 保持依赖隔离
  - 使用独立的 node_modules
  - 明确依赖边界

### 6.2 维护风险

#### 风险 4: 双重维护负担
- **描述**：需要同时维护 OpenWork 和集成代码
- **影响**：增加维护成本
- **缓解**：
  - 最小化集成代码
  - 清晰的代码边界
  - 完善的文档

## 7. 时间线

### 阶段 1: 基础集成（1-2 天）
- 创建 VS Code 集成代码结构
- 实现基本的窗口启动功能
- 配置构建流程

### 阶段 2: 命令集成（0.5 天）
- 实现命令行参数支持
- 实现命令面板命令
- 添加状态栏按钮（可选）

### 阶段 3: 构建优化（1 天）
- 优化构建流程
- 实现开发模式热重载
- 测试生产构建

### 阶段 4: 测试与文档（1 天）
- 跨平台测试
- 性能测试
- 编写文档

**总计**：3-4 天

## 8. 后续扩展

### 8.1 高级通信
- 实现完整的 IPC 通信协议
- 支持 OpenWork 调用 VS Code API
- 支持 VS Code 向 OpenWork 发送事件

### 8.2 深度集成
- 共享 VS Code 的主题设置
- 共享 VS Code 的快捷键配置
- 集成 VS Code 的文件系统

### 8.3 多窗口支持
- 支持打开多个 OpenWork 窗口
- 窗口间通信
- 窗口状态管理

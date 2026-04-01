# AionUI 集成到 VS Code - 实施任务

## 任务概述

本文档定义了将 AionUI 集成到 VS Code 的具体实施任务。任务按照依赖关系和优先级组织。

---

## 阶段 1: 环境变量加载增强（修复生产环境智能体检测问题）

### 任务 1: 增强 shellEnv.ts 的环境变量加载逻辑

**目标**: 确保打包后的应用能正确加载用户的 shell 环境变量，解决生产环境下智能体检测失败的问题。

- [ ] 1.1 实现多 shell 尝试机制
  - 按优先级尝试多个 shell（$SHELL, /bin/zsh, /bin/bash）
  - 增加超时时间到 10 秒
  - 添加详细的日志记录

- [ ] 1.2 实现回退环境变量方案
  - 创建 `getFallbackEnvironment()` 函数
  - 构建常见的 PATH 路径列表（系统路径 + 用户路径）
  - 过滤出存在的路径
  - 在 shell 加载失败时使用回退方案

- [ ] 1.3 添加诊断日志
  - 在 `AcpDetector.initialize()` 中添加环境信息日志
  - 记录 platform, isPackaged, HOME, SHELL, PATH
  - 帮助排查生产环境问题

- [ ] 1.4 测试环境变量加载
  - 测试开发环境（scripts/code.sh）
  - 测试生产环境（打包后的应用）
  - 验证 PATH 是否包含用户自定义路径
  - 验证智能体是否能被正确检测

### 任务 2: 添加常见 CLI 路径检测

**目标**: 在 which/where 命令失败时，尝试在常见位置查找 CLI 工具。

- [ ] 2.1 定义常见 CLI 位置映射
  - 创建 `COMMON_CLI_LOCATIONS` 常量
  - 为每个 CLI 工具定义常见安装位置
  - 包括 /usr/local/bin, /opt/homebrew/bin, ~/.local/bin 等

- [ ] 2.2 实现 findCliInCommonLocations 函数
  - 遍历常见位置列表
  - 使用 fs.accessSync 检查文件是否存在且可执行
  - 返回找到的完整路径或 null

- [ ] 2.3 集成到 isCliAvailable 函数
  - 在 which/where 失败后调用 findCliInCommonLocations
  - 记录找到的完整路径
  - 更新检测结果

- [ ] 2.4 测试常见路径检测
  - 测试 CLI 安装在不同位置的情况
  - 验证检测逻辑是否正确
  - 确保日志记录完整路径

### 任务 3: 添加手动配置选项（可选）

**目标**: 允许用户手动指定 CLI 工具的路径，作为自动检测的补充。

- [ ]* 3.1 创建 AgentSettings 配置界面
  - 在 AionUI 设置页面添加 "Agent CLI Paths" 部分
  - 为每个 CLI 工具提供输入框
  - 添加 "Save and Re-detect" 按钮

- [ ]* 3.2 实现自定义路径存储
  - 使用 ProcessConfig 存储自定义路径
  - 配置键: `acp.customCliPaths`
  - 格式: `{ [backend: string]: string }`

- [ ]* 3.3 修改 AcpDetector 支持自定义路径
  - 在 initialize() 中读取自定义路径配置
  - 验证路径是否存在且可执行
  - 将自定义路径添加到检测结果

- [ ]* 3.4 测试手动配置功能
  - 测试添加自定义路径
  - 测试保存和重新检测
  - 验证自定义路径优先级

### 任务 4: 添加诊断工具（可选）

**目标**: 提供诊断工具帮助用户排查智能体检测问题。

- [ ]* 4.1 实现诊断 IPC 接口
  - 创建 `acp:runDiagnostic` IPC handler
  - 收集环境变量信息
  - 收集检测到的智能体列表
  - 检查 PATH 目录是否存在
  - 检查常见 CLI 位置

- [ ]* 4.2 创建诊断界面组件
  - 创建 DiagnosticTool React 组件
  - 显示环境变量
  - 显示检测到的智能体
  - 显示 PATH 目录状态
  - 显示常见 CLI 位置检查结果

- [ ]* 4.3 集成到设置页面
  - 在 AionUI 设置中添加 "Diagnostic" 标签
  - 添加 "Run Diagnostic" 按钮
  - 显示诊断结果

- [ ]* 4.4 测试诊断工具
  - 测试诊断信息的准确性
  - 测试在不同环境下的表现
  - 验证诊断结果的可读性

---

## 阶段 2: 基础集成架构（如需要）

### 任务 5: 创建 VS Code 集成代码结构

**目标**: 建立 AionUI 与 VS Code 集成的基础代码结构。

- [ ]* 5.1 创建目录结构
  - 创建 `src/vs/aionui/` 目录
  - 创建子目录: `electron-main/`, `common/`, `browser/`
  - 创建 `build/gulpfile.aionui.js`

- [ ]* 5.2 定义常量和类型
  - 创建 `src/vs/aionui/common/aionui.ts`
  - 定义窗口配置常量
  - 定义 TypeScript 接口

- [ ]* 5.3 定义 IPC 协议（可选）
  - 创建 `src/vs/aionui/common/aionuiIpc.ts`
  - 定义 IPC 频道枚举
  - 定义消息类型接口

### 任务 6: 实现 AionUIWindowManager

**目标**: 实现 AionUI 窗口的生命周期管理。

- [ ]* 6.1 创建 AionUIWindowManager 类
  - 创建 `src/vs/aionui/electron-main/aionuiWindowManager.ts`
  - 实现 IAionUIWindowManager 接口
  - 实现单例模式

- [ ]* 6.2 实现窗口创建逻辑
  - 实现 `openWindow()` 方法
  - 配置 BrowserWindow 选项
  - 处理开发模式和生产模式的 URL 加载
  - 添加窗口事件监听

- [ ]* 6.3 实现窗口管理方法
  - 实现 `closeWindow()` 方法
  - 实现 `isWindowOpen()` 方法
  - 实现 `getWindow()` 方法
  - 实现窗口聚焦逻辑

- [ ]* 6.4 添加错误处理
  - 捕获窗口创建错误
  - 显示错误对话框
  - 记录错误日志

### 任务 7: 集成到 WindowsMainService

**目标**: 将 AionUI 窗口管理集成到 VS Code 的窗口服务中。

- [ ]* 7.1 修改 WindowsMainService
  - 在 `src/vs/platform/windows/electron-main/windowsMainService.ts` 中添加 `openAionUIWindow()` 方法
  - 实现延迟加载 AionUIWindowManager
  - 调用 AionUIWindowManager.openWindow()

- [ ]* 7.2 添加依赖注入
  - 注册 AionUIWindowManager 到 DI 容器
  - 配置服务依赖关系

### 任务 8: 实现命令行参数支持

**目标**: 支持通过 `--aionui` 命令行参数启动 AionUI。

- [ ]* 8.1 修改 LaunchMainService
  - 在 `src/vs/platform/launch/electron-main/launchMainService.ts` 中添加 `--aionui` 参数处理
  - 调用 WindowsMainService.openAionUIWindow()

- [ ]* 8.2 添加命令行参数定义
  - 在命令行参数解析器中注册 `--aionui` 参数
  - 添加参数说明文档

- [ ]* 8.3 测试命令行启动
  - 测试 `code --aionui` 命令
  - 验证窗口是否正确打开
  - 测试与其他参数的组合

---

## 阶段 3: 命令和 UI 集成（如需要）

### 任务 9: 实现命令面板命令

**目标**: 在 VS Code 命令面板中添加打开 AionUI 的命令。

- [ ]* 9.1 创建命令贡献文件
  - 创建 `src/vs/aionui/browser/aionui.contribution.ts`
  - 定义 OpenAionUIWindowAction 类
  - 继承 Action2 基类

- [ ]* 9.2 实现命令逻辑
  - 实现 `run()` 方法
  - 通过 INativeHostService 调用主进程
  - 添加错误处理

- [ ]* 9.3 注册命令
  - 使用 registerAction2 注册命令
  - 配置命令 ID: `workbench.action.openAionUIWindow`
  - 配置命令标题和分类
  - 启用 F1 快捷键

- [ ]* 9.4 测试命令面板
  - 测试命令是否出现在命令面板
  - 测试命令执行是否正常
  - 测试快捷键是否生效

### 任务 10: 添加状态栏按钮（可选）

**目标**: 在状态栏添加 AionUI 快捷按钮。

- [ ]* 10.1 创建状态栏项组件
  - 创建 `src/vs/aionui/browser/aionuiStatusbarItem.ts`
  - 实现 AionUIStatusbarItem 类
  - 继承 Disposable 基类

- [ ]* 10.2 配置状态栏项
  - 设置图标: `$(robot)`
  - 设置文本: "AionUI"
  - 设置命令: `workbench.action.openAionUIWindow`
  - 设置位置: 右侧，优先级 100

- [ ]* 10.3 注册状态栏项
  - 在 workbench 启动时注册
  - 添加到 DI 容器

- [ ]* 10.4 测试状态栏按钮
  - 验证按钮是否显示
  - 测试点击是否打开窗口
  - 测试图标和文本是否正确

---

## 阶段 4: 构建系统集成（如需要）

### 任务 11: 创建 AionUI 构建任务

**目标**: 创建 Gulp 任务来构建 AionUI。

- [ ]* 11.1 创建 gulpfile.aionui.js
  - 创建 `build/gulpfile.aionui.js`
  - 定义常量: AIONUI_ROOT, OUT_DIR

- [ ]* 11.2 实现 build-aionui 任务
  - 检查 AionUI 目录是否存在
  - 安装依赖（如果需要）
  - 运行 `bun run package` 构建
  - 复制构建产物到 `out/aionui/dist`
  - 复制资源文件到 `out/aionui/resources`

- [ ]* 11.3 实现 clean-aionui 任务
  - 清理 `out/aionui/` 目录
  - 清理 `extensions/aionui-main/out/` 目录

- [ ]* 11.4 实现 watch-aionui 任务（开发模式）
  - 提示用户单独运行 AionUI 开发服务器
  - 不执行实际的构建

- [ ]* 11.5 添加辅助函数
  - 实现 `runCommand()` 函数执行子进程
  - 实现 `checkIfRebuildNeeded()` 函数检查是否需要重新构建

### 任务 12: 集成到 VS Code 构建流程

**目标**: 将 AionUI 构建集成到 VS Code 的主构建流程中。

- [ ]* 12.1 修改 gulpfile.vscode.js
  - 导入 `gulpfile.aionui.js`
  - 在 `vscode-darwin-min` 任务中添加 `build-aionui`
  - 在 `vscode-win32-min` 任务中添加 `build-aionui`
  - 在 `vscode-linux-min` 任务中添加 `build-aionui`

- [ ]* 12.2 更新 package.json 脚本
  - 添加 `build:aionui` 脚本
  - 更新 `build` 脚本包含 AionUI 构建
  - 添加 `clean:aionui` 脚本

- [ ]* 12.3 测试构建流程
  - 测试完整构建: `npm run build`
  - 测试清理: `npm run clean:aionui`
  - 验证构建产物是否正确

### 任务 13: 实现开发模式支持

**目标**: 在开发模式下支持 AionUI 热重载。

- [ ]* 13.1 实现开发服务器检测
  - 在 AionUIWindowManager 中实现 `checkDevServer()` 方法
  - 尝试连接 `http://localhost:5173`
  - 返回服务器是否可用

- [ ]* 13.2 实现 URL 选择逻辑
  - 在 `getLoadUrl()` 中检测环境
  - 开发模式且服务器可用: 使用 `http://localhost:5173`
  - 否则: 使用打包后的文件路径

- [ ]* 13.3 添加开发模式日志
  - 记录使用的 URL
  - 记录是否启用热重载
  - 记录开发服务器状态

- [ ]* 13.4 测试开发模式
  - 启动 AionUI 开发服务器
  - 启动 VS Code 开发模式
  - 验证热重载是否工作
  - 测试代码修改是否自动刷新

---

## 阶段 5: IPC 通信实现（可选）

### 任务 14: 实现基础 IPC 通信

**目标**: 实现 AionUI 与 VS Code 之间的基础通信。

- [ ]* 14.1 实现 IPC 处理器
  - 在 AionUIWindowManager 中实现 `setupIpcHandlers()` 方法
  - 注册 IPC 频道处理器
  - 实现错误处理

- [ ]* 14.2 实现工作区信息获取
  - 实现 `getWorkspaceInfo()` 方法
  - 返回工作区文件夹列表
  - 返回工作区名称

- [ ]* 14.3 实现当前文件获取
  - 实现 `getCurrentFile()` 方法
  - 获取当前活动编辑器
  - 返回文件路径和内容

- [ ]* 14.4 实现文件打开
  - 实现 `openFile()` 方法
  - 调用 VS Code 的文件服务
  - 支持指定行号和列号

- [ ]* 14.5 测试 IPC 通信
  - 测试从 AionUI 调用 IPC
  - 验证返回数据的正确性
  - 测试错误处理

---

## 阶段 6: 测试和文档（如需要）

### 任务 15: 编写单元测试

**目标**: 为核心组件编写单元测试。

- [ ]* 15.1 测试 AionUIWindowManager
  - 测试窗口创建
  - 测试单例模式
  - 测试窗口关闭
  - 测试错误处理

- [ ]* 15.2 测试命令
  - 测试命令注册
  - 测试命令执行
  - 测试错误处理

- [ ]* 15.3 测试构建任务
  - 测试构建流程
  - 测试清理任务
  - 测试错误处理

### 任务 16: 编写集成测试

**目标**: 测试 AionUI 与 VS Code 的集成。

- [ ]* 16.1 测试命令行启动
  - 测试 `--aionui` 参数
  - 验证窗口是否打开
  - 测试与其他参数的组合

- [ ]* 16.2 测试命令面板
  - 测试命令是否可用
  - 测试命令执行
  - 验证窗口行为

- [ ]* 16.3 测试 IPC 通信
  - 测试双向通信
  - 测试数据传输
  - 测试错误处理

### 任务 17: 跨平台测试

**目标**: 在所有支持的平台上测试。

- [ ]* 17.1 macOS 测试
  - 测试构建
  - 测试运行
  - 测试所有功能

- [ ]* 17.2 Windows 测试
  - 测试构建
  - 测试运行
  - 测试所有功能

- [ ]* 17.3 Linux 测试
  - 测试构建
  - 测试运行
  - 测试所有功能

### 任务 18: 性能测试

**目标**: 验证性能指标。

- [ ]* 18.1 测试启动速度
  - 测量窗口打开时间
  - 验证是否 < 2 秒

- [ ]* 18.2 测试内存占用
  - 测量窗口内存使用
  - 验证是否 < 500MB

- [ ]* 18.3 测试对 VS Code 的影响
  - 测量 VS Code 性能变化
  - 验证无明显影响

### 任务 19: 编写文档

**目标**: 提供完整的文档。

- [ ]* 19.1 编写用户文档
  - 创建 `docs/aionui/USER_GUIDE.md`
  - 说明如何启动 AionUI
  - 介绍功能
  - 提供常见问题解答

- [ ]* 19.2 编写开发文档
  - 创建 `docs/aionui/DEVELOPMENT.md`
  - 说明架构设计
  - 提供开发环境设置指南
  - 说明构建流程
  - 提供调试技巧

- [ ]* 19.3 编写 API 文档
  - 创建 `docs/aionui/API.md`
  - 说明 IPC 通信协议
  - 说明扩展点
  - 提供示例代码

- [ ]* 19.4 更新主 README
  - 在主 README 中添加 AionUI 部分
  - 提供快速开始指南
  - 链接到详细文档

---

## 验收标准

### 功能验收
- [ ] 可以通过 `code --aionui` 启动 AionUI 窗口
- [ ] 可以通过命令面板启动 AionUI 窗口
- [ ] AionUI 窗口独立运行，不影响 VS Code 主窗口
- [ ] 只能同时打开一个 AionUI 窗口
- [ ] AionUI 的所有功能正常工作
- [ ] 生产环境下智能体检测正常工作

### 构建验收
- [ ] VS Code 构建时自动构建 AionUI
- [ ] AionUI 可以独立构建
- [ ] 开发模式下支持热重载
- [ ] 生产构建正常工作

### 性能验收
- [ ] AionUI 窗口启动时间 < 2 秒
- [ ] 内存占用合理（< 500MB）
- [ ] 不影响 VS Code 主窗口性能

### 兼容性验收
- [ ] 在 macOS 上正常运行
- [ ] 在 Windows 上正常运行
- [ ] 在 Linux 上正常运行

---

## 注意事项

1. **优先级**: 阶段 1（环境变量加载增强）是当前最高优先级，必须先完成
2. **标记说明**:
   - 无标记 = 必须完成的任务
   - `*` 标记 = 可选任务（如果不需要完整的 VS Code 集成）
3. **依赖关系**: 某些任务有依赖关系，需要按顺序完成
4. **测试**: 每个任务完成后都应该进行测试
5. **文档**: 重要的修改都应该添加注释和文档
6. **代码标记**: 所有修改都应该使用 `test-workbench_change` 标记

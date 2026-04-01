# VS Code + AionUI 打包完成指南

## ✅ 已完成的工作

### 1. 构建系统集成

已在 VS Code 的构建系统中集成 AionUI：

- ✅ 创建了 `build/gulpfile.aionui.js` - AionUI 构建任务
- ✅ 修改了 `build/gulpfile.vscode.ts` - 在打包流程中自动调用 AionUI 构建
- ✅ 所有平台的打包任务都会自动包含 AionUI

### 2. 自动化脚本

创建了三个便捷脚本：

1. **快速构建脚本** (`scripts/quick-build.sh`)
   - 一键构建当前平台的 VS Code + AionUI
   - 自动检测平台和架构
   - 最简单快速的打包方式

2. **完整构建脚本** (`scripts/build-vscode-with-aionui.sh`)
   - 支持跨平台构建
   - 支持跳过特定步骤
   - 提供详细的构建日志
   - 支持自定义选项

3. **验证脚本** (`scripts/verify-package.sh`)
   - 验证打包结果是否正确
   - 检查所有必需文件
   - 提供测试命令

### 3. 文档

创建了完整的文档：

- ✅ `BUILD_README.md` - 快速开始指南
- ✅ `PACKAGING_GUIDE.md` - 详细打包指南
- ✅ `PACKAGING_COMPLETE.md` - 本文档

## 🚀 如何打包

### 方法 1: 快速打包（推荐）

```bash
./scripts/quick-build.sh
```

这是最简单的方式，适合大多数情况。

### 方法 2: 使用 npm 命令

```bash
# 1. 构建 AionUI
cd extensions/aionui-main
bun run package
cd ../..

# 2. 打包 VS Code（会自动包含 AionUI）
npm run gulp vscode-darwin-arm64  # macOS ARM64
# 或
npm run gulp vscode-darwin-x64    # macOS Intel
# 或
npm run gulp vscode-linux-x64     # Linux
# 或
npm run gulp vscode-win32-x64     # Windows
```

### 方法 3: 使用完整构建脚本

```bash
# 查看所有选项
./scripts/build-vscode-with-aionui.sh --help

# 基本用法
./scripts/build-vscode-with-aionui.sh

# 跳过 AionUI 构建（如果已经构建过）
./scripts/build-vscode-with-aionui.sh --skip-aionui

# 为特定平台构建
./scripts/build-vscode-with-aionui.sh --platform darwin --arch arm64
```

## 🧪 如何测试

### 1. 验证打包结果

```bash
./scripts/verify-package.sh
```

这个脚本会检查：
- ✅ 打包目录是否存在
- ✅ VS Code 可执行文件是否存在
- ✅ AionUI 文件是否正确包含
- ✅ AionUI 构建产物是否完整
- ✅ 集成文件是否存在

### 2. 测试 AionUI 启动

#### 方法 A: 命令行启动

```bash
# macOS
cd ../VSCode-darwin-arm64
./Code\ -\ OSS.app/Contents/MacOS/Electron --aionui

# Linux
cd ../VSCode-linux-x64
./code --aionui

# Windows
cd ..\VSCode-win32-x64
Code.exe --aionui
```

#### 方法 B: 命令面板启动

1. 启动打包后的 VS Code（不带 `--aionui` 参数）
2. 按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux)
3. 输入 "Open AionUI Window"
4. 按回车

## 📦 打包结果

打包完成后，你会得到：

```
../VSCode-{platform}-{arch}/
├── Code - OSS.app/                    # macOS
│   └── Contents/
│       ├── MacOS/
│       │   └── Electron               # VS Code 可执行文件
│       └── Resources/
│           └── app/
│               ├── extensions/
│               │   └── aionui-main/   # AionUI 应用
│               │       ├── out/       # AionUI 构建产物
│               │       ├── node_modules/
│               │       └── package.json
│               └── out/
│                   └── vs/
│                       └── aionui/    # VS Code 集成代码
│
├── resources/app/                     # Linux/Windows
│   ├── extensions/
│   │   └── aionui-main/               # AionUI 应用
│   └── out/
│       └── vs/
│           └── aionui/                # VS Code 集成代码
│
└── code / Code.exe                    # Linux/Windows 可执行文件
```

## 🎯 关键文件说明

### AionUI 应用文件

- `extensions/aionui-main/out/main/` - AionUI 主进程代码
- `extensions/aionui-main/out/preload/` - AionUI 预加载脚本
- `extensions/aionui-main/out/renderer/` - AionUI 渲染进程代码（UI）
- `extensions/aionui-main/node_modules/.bin/electron` - Electron 可执行文件

### VS Code 集成文件

- `out/vs/aionui/electron-main/aionuiWindowManager.js` - 窗口管理器
- `out/vs/aionui/common/aionui.js` - 公共类型和常量
- `out/vs/workbench/contrib/aionui/` - 命令面板集成

## 📊 构建时间和大小

### 构建时间

- AionUI 构建：约 1-2 分钟
- VS Code 打包：约 5-10 分钟
- **总计：约 6-12 分钟**

### 打包大小

- VS Code 基础：约 200-300 MB
- AionUI：约 50-100 MB
- **总计：约 300-500 MB**

## 🔧 故障排查

### 问题 1: AionUI 未包含在打包中

**检查**：
```bash
./scripts/verify-package.sh
```

**解决**：
1. 确认 AionUI 已构建：`ls -la extensions/aionui-main/out/`
2. 重新运行打包：`./scripts/quick-build.sh`

### 问题 2: AionUI 启动失败

**检查日志**：
```bash
# macOS
tail -f ~/Library/Application\ Support/Code\ -\ OSS/logs/main.log

# Linux
tail -f ~/.config/Code\ -\ OSS/logs/main.log

# Windows
type %APPDATA%\Code - OSS\logs\main.log
```

**常见原因**：
1. Electron 可执行文件缺失
2. AionUI 构建产物不完整
3. 路径配置错误

**解决**：
1. 运行验证脚本：`./scripts/verify-package.sh`
2. 检查错误日志
3. 重新构建 AionUI：`cd extensions/aionui-main && bun run package`

### 问题 3: 命令面板找不到 "Open AionUI Window"

**检查**：
```bash
# 检查集成文件是否存在
ls -la ../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/vs/aionui/
```

**解决**：
1. 清理并重新构建：
   ```bash
   npm run gulp clean
   ./scripts/quick-build.sh
   ```

## 📝 下一步

打包完成后，你可以：

### 1. 创建安装包

#### macOS - 创建 DMG

```bash
# 安装 create-dmg
npm install -g create-dmg

# 创建 DMG
create-dmg ../VSCode-darwin-arm64/Code\ -\ OSS.app --overwrite
```

#### Windows - 创建安装程序

使用 Inno Setup 或 NSIS 创建安装程序。VS Code 的配置文件在 `build/win32/` 目录。

#### Linux - 创建 DEB/RPM

```bash
# DEB
npm run gulp vscode-linux-x64-build-deb

# RPM
npm run gulp vscode-linux-x64-build-rpm
```

### 2. 分发应用

- 上传到文件服务器
- 创建下载页面
- 提供安装说明

### 3. 持续集成

将构建流程集成到 CI/CD 系统（GitHub Actions, GitLab CI 等）。

参考 `.kiro/specs/aionui-integration/PACKAGING_GUIDE.md` 中的 CI 配置示例。

## 🎉 总结

你现在拥有：

✅ 完整的构建系统集成
✅ 自动化构建脚本
✅ 验证和测试工具
✅ 详细的文档

只需运行 `./scripts/quick-build.sh`，就可以得到一个包含 AionUI 的 VS Code 安装包！

## 📚 相关文档

- [快速开始指南](./BUILD_README.md)
- [详细打包指南](./PACKAGING_GUIDE.md)
- [设计文档](./design.md)
- [需求文档](./requirements.md)
- [任务列表](./tasks.md)

---

**祝你打包顺利！** 🚀

如有问题，请查看故障排查部分或查看 VS Code 日志文件。

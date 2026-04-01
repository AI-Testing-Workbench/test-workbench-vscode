# VS Code + AionUI 打包指南

本文档说明如何将集成了 AionUI 的 VS Code 打包成安装包。

## 前提条件

1. **AionUI 已构建**：确保 `extensions/aionui-main/out/` 目录存在且包含构建产物
2. **VS Code 开发环境已配置**：已运行 `npm install` 安装所有依赖
3. **平台工具**：
   - macOS: 需要 Xcode Command Line Tools
   - Windows: 需要 Visual Studio Build Tools
   - Linux: 需要基本构建工具

## 打包流程

### 1. 构建 AionUI（如果尚未构建）

```bash
cd extensions/aionui-main
bun install  # 或 npm install
bun run package  # 或 npm run package
cd ../..
```

### 2. 打包 VS Code（包含 AionUI）

根据你的平台选择相应的命令：

#### macOS (推荐)

```bash
# 构建 macOS 版本（包含 AionUI）
npm run gulp vscode-darwin-arm64

# 或者构建 x64 版本
npm run gulp vscode-darwin-x64

# 或者同时构建两个架构
npm run gulp vscode-darwin-arm64 vscode-darwin-x64
```

构建完成后，安装包位于：
- `../VSCode-darwin-arm64/` - ARM64 版本
- `../VSCode-darwin-x64/` - x64 版本

#### Windows

```bash
# 构建 Windows 版本（包含 AionUI）
npm run gulp vscode-win32-x64

# 或者构建 ARM64 版本
npm run gulp vscode-win32-arm64
```

构建完成后，安装包位于：
- `../VSCode-win32-x64/` - x64 版本
- `../VSCode-win32-arm64/` - ARM64 版本

#### Linux

```bash
# 构建 Linux 版本（包含 AionUI）
npm run gulp vscode-linux-x64

# 或者构建 ARM64 版本
npm run gulp vscode-linux-arm64

# 或者构建 ARMhf 版本
npm run gulp vscode-linux-armhf
```

构建完成后，安装包位于：
- `../VSCode-linux-x64/` - x64 版本
- `../VSCode-linux-arm64/` - ARM64 版本
- `../VSCode-linux-armhf/` - ARMhf 版本

## 验证打包结果

### 1. 检查 AionUI 文件是否包含

打包完成后，检查以下文件是否存在：

```bash
# macOS
ls -la ../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/extensions/aionui-main/

# Windows
dir ..\VSCode-win32-x64\resources\app\extensions\aionui-main\

# Linux
ls -la ../VSCode-linux-x64/resources/app/extensions/aionui-main/
```

应该看到以下目录结构：
```
extensions/aionui-main/
├── out/
│   ├── main/
│   ├── preload/
│   └── renderer/
├── node_modules/
│   └── .bin/
│       └── electron
└── package.json
```

### 2. 测试 AionUI 启动

#### macOS

```bash
# 进入打包目录
cd ../VSCode-darwin-arm64

# 测试命令行启动
./Code\ -\ OSS.app/Contents/MacOS/Electron --aionui

# 或者使用 code 命令（如果已安装）
./Code\ -\ OSS.app/Contents/Resources/app/bin/code --aionui
```

#### Windows

```cmd
# 进入打包目录
cd ..\VSCode-win32-x64

# 测试命令行启动
Code.exe --aionui
```

#### Linux

```bash
# 进入打包目录
cd ../VSCode-linux-x64

# 测试命令行启动
./code --aionui
```

### 3. 测试命令面板

1. 启动打包后的 VS Code（不带 `--aionui` 参数）
2. 按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux) 打开命令面板
3. 输入 "Open AionUI Window"
4. 按回车，应该会启动 AionUI 窗口

## 创建安装包（可选）

### macOS - 创建 DMG

```bash
# 安装 create-dmg（如果尚未安装）
npm install -g create-dmg

# 创建 DMG
create-dmg ../VSCode-darwin-arm64/Code\ -\ OSS.app --overwrite
```

### Windows - 创建安装程序

VS Code 使用 Inno Setup 创建 Windows 安装程序。相关配置在 `build/win32/` 目录。

```bash
# 运行 Windows 打包脚本（需要在 Windows 上运行）
npm run gulp vscode-win32-x64-inno-updater
```

### Linux - 创建 DEB/RPM

```bash
# 创建 DEB 包
npm run gulp vscode-linux-x64-build-deb

# 创建 RPM 包
npm run gulp vscode-linux-x64-build-rpm
```

## 故障排查

### 问题 1: AionUI 文件未包含在打包中

**症状**：打包后的 VS Code 中找不到 `extensions/aionui-main/` 目录

**解决方案**：
1. 确认 `build/gulpfile.vscode.ts` 中已添加 `gulp.task('build-aionui')` 调用
2. 检查 `build/gulpfile.aionui.js` 是否正确导入
3. 重新运行打包命令

### 问题 2: AionUI 启动失败

**症状**：运行 `--aionui` 参数时出错

**可能原因**：
1. AionUI 的 `node_modules` 未包含在打包中
2. Electron 可执行文件路径不正确

**解决方案**：
1. 检查 `extensions/aionui-main/node_modules/.bin/electron` 是否存在
2. 检查 `src/vs/aionui/electron-main/aionuiWindowManager.js` 中的路径配置
3. 查看 VS Code 日志：
   ```bash
   # macOS/Linux
   tail -f ~/Library/Application\ Support/Code\ -\ OSS/logs/main.log

   # Windows
   type %APPDATA%\Code - OSS\logs\main.log
   ```

### 问题 3: 命令面板找不到 "Open AionUI Window"

**症状**：命令面板中搜索不到 AionUI 相关命令

**解决方案**：
1. 确认 `src/vs/workbench/contrib/aionui/browser/aionui.contribution.ts` 已正确编译
2. 检查 `out-vscode-min/vs/workbench/workbench.desktop.main.js` 是否包含 AionUI 相关代码
3. 清理并重新构建：
   ```bash
   npm run gulp clean
   npm run gulp vscode-darwin-arm64
   ```

## 开发模式 vs 生产模式

### 开发模式

在开发模式下，AionUI 可以连接到开发服务器（`http://localhost:5173`）：

```bash
# 终端 1: 启动 AionUI 开发服务器
cd extensions/aionui-main
bun run start

# 终端 2: 启动 VS Code 开发模式
cd ../..
./scripts/code.sh --aionui
```

### 生产模式

在生产模式（打包后），AionUI 使用构建后的静态文件：

```bash
# 打包后的 VS Code 会自动使用 extensions/aionui-main/out/ 中的构建产物
./Code\ -\ OSS.app/Contents/MacOS/Electron --aionui
```

## 自动化打包脚本

为了简化打包流程，可以创建一个自动化脚本：

```bash
#!/bin/bash
# build-vscode-with-aionui.sh

set -e

echo "=== Building VS Code with AionUI ==="

# 1. 构建 AionUI
echo "Step 1: Building AionUI..."
cd extensions/aionui-main
bun install
bun run package
cd ../..

# 2. 打包 VS Code
echo "Step 2: Packaging VS Code..."
npm run gulp vscode-darwin-arm64

# 3. 验证
echo "Step 3: Verifying package..."
if [ -d "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/extensions/aionui-main/out" ]; then
    echo "✓ AionUI files found in package"
else
    echo "✗ AionUI files NOT found in package"
    exit 1
fi

echo "=== Build Complete ==="
echo "Package location: ../VSCode-darwin-arm64/"
echo ""
echo "To test:"
echo "  cd ../VSCode-darwin-arm64"
echo "  ./Code\\ -\\ OSS.app/Contents/MacOS/Electron --aionui"
```

使用方法：

```bash
chmod +x build-vscode-with-aionui.sh
./build-vscode-with-aionui.sh
```

## 持续集成（CI）

如果使用 CI/CD 系统，可以添加以下步骤：

```yaml
# .github/workflows/build.yml 示例
name: Build VS Code with AionUI

on:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: macos-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '22'

    - name: Setup Bun
      uses: oven-sh/setup-bun@v1

    - name: Install VS Code dependencies
      run: npm install

    - name: Build AionUI
      run: |
        cd extensions/aionui-main
        bun install
        bun run package
        cd ../..

    - name: Package VS Code
      run: npm run gulp vscode-darwin-arm64

    - name: Upload artifact
      uses: actions/upload-artifact@v3
      with:
        name: vscode-darwin-arm64
        path: ../VSCode-darwin-arm64/
```

## 总结

打包流程的关键点：

1. ✅ AionUI 必须先构建（`bun run package`）
2. ✅ `build/gulpfile.vscode.ts` 已配置自动调用 `build-aionui` 任务
3. ✅ 打包时会自动包含 `extensions/aionui-main/` 目录
4. ✅ 打包后的 VS Code 可以通过 `--aionui` 参数或命令面板启动 AionUI

如有问题，请查看故障排查部分或查看 VS Code 日志文件。

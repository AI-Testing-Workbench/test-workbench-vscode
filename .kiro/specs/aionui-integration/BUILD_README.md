# 如何打包 VS Code + AionUI

本文档提供快速打包指南。

## 🚀 快速开始（推荐）

使用快速构建脚本一键打包：

```bash
./scripts/quick-build.sh
```

这个脚本会：
1. 自动检测你的平台和架构
2. 构建 AionUI
3. 打包 VS Code（包含 AionUI）
4. 显示打包结果位置和测试命令

## 📦 手动打包步骤

如果你想手动控制每个步骤：

### 步骤 1: 构建 AionUI

```bash
cd extensions/aionui-main
bun install          # 或 npm install
bun run package      # 或 npm run package
cd ../..
```

### 步骤 2: 打包 VS Code

根据你的平台选择命令：

```bash
# macOS ARM64 (Apple Silicon)
npm run gulp vscode-darwin-arm64

# macOS x64 (Intel)
npm run gulp vscode-darwin-x64

# Linux x64
npm run gulp vscode-linux-x64

# Windows x64
npm run gulp vscode-win32-x64
```

### 步骤 3: 查找打包结果

打包完成后，文件位于：

```bash
# macOS
../VSCode-darwin-arm64/Code - OSS.app

# Linux
../VSCode-linux-x64/

# Windows
../VSCode-win32-x64/
```

## 🧪 测试打包结果

### 方法 1: 命令行启动 AionUI

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

### 方法 2: 命令面板启动 AionUI

1. 启动打包后的 VS Code（不带 `--aionui` 参数）
2. 按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux)
3. 输入 "Open AionUI Window"
4. 按回车

## 🔧 高级选项

使用完整的构建脚本获得更多控制：

```bash
# 查看所有选项
./scripts/build-vscode-with-aionui.sh --help

# 跳过 AionUI 构建（如果已经构建过）
./scripts/build-vscode-with-aionui.sh --skip-aionui

# 为特定平台构建
./scripts/build-vscode-with-aionui.sh --platform darwin --arch arm64
```

## ❓ 常见问题

### Q: 打包需要多长时间？

A:
- AionUI 构建：约 1-2 分钟
- VS Code 打包：约 5-10 分钟
- 总计：约 6-12 分钟（取决于你的机器性能）

### Q: 打包后的文件有多大？

A: 约 300-500 MB（包含 VS Code 和 AionUI）

### Q: 如何验证 AionUI 是否正确打包？

A: 检查以下文件是否存在：

```bash
# macOS
ls -la ../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/extensions/aionui-main/out/

# Linux
ls -la ../VSCode-linux-x64/resources/app/extensions/aionui-main/out/

# Windows
dir ..\VSCode-win32-x64\resources\app\extensions\aionui-main\out\
```

应该看到 `main/`, `preload/`, `renderer/` 三个目录。

### Q: 打包失败怎么办？

A:
1. 检查错误信息
2. 确保所有依赖已安装：`npm install`
3. 清理并重试：
   ```bash
   npm run gulp clean
   ./scripts/quick-build.sh
   ```
4. 查看详细日志：`npm run gulp vscode-darwin-arm64 --verbose`

### Q: 可以同时打包多个平台吗？

A: 可以，但需要在对应的平台上构建：
- macOS 构建需要在 macOS 上进行
- Windows 构建需要在 Windows 上进行
- Linux 构建可以在 Linux 或 macOS 上进行

## 📚 更多信息

- 详细打包指南：[PACKAGING_GUIDE.md](./PACKAGING_GUIDE.md)
- AionUI 集成设计：[design.md](./design.md)
- 任务列表：[tasks.md](./tasks.md)

## 🎯 下一步

打包完成后，你可以：

1. **测试功能**：确保 `--aionui` 参数和命令面板都能正常启动 AionUI
2. **创建安装包**：使用 DMG (macOS)、Installer (Windows) 或 DEB/RPM (Linux)
3. **分发**：将打包好的应用分发给用户

祝你打包顺利！🎉

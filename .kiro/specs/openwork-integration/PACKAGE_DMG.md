# 📦 OpenWork 集成 - macOS DMG 打包指南

## 🎯 目标

将集成了 OpenWork 的 VS Code 打包成 macOS 安装包（DMG），用于分发和测试。

## 🚀 快速开始

### 一键打包（推荐）

```bash
# 构建并创建 DMG
./scripts/build-vscode-with-openwork.sh --dmg
```

这个命令会：
1. ✅ 构建 OpenWork UI（使用 Vite + 相对路径）
2. ✅ 复制构建产物到 VS Code 输出目录
3. ✅ 编译 VS Code TypeScript 代码
4. ✅ 打包 VS Code 应用
5. ✅ 创建 DMG 安装包

### 分步执行

如果需要更细粒度的控制：

```bash
# 1. 只构建 OpenWork（跳过 VS Code）
./scripts/build-vscode-with-openwork.sh --skip-vscode

# 2. 只打包 VS Code（跳过 OpenWork 构建）
./scripts/build-vscode-with-openwork.sh --skip-openwork --dmg

# 3. 构建但不创建 DMG
./scripts/build-vscode-with-openwork.sh
```

## 📋 前置要求

### 必需工具

1. **Node.js & npm**
   ```bash
   node --version  # 应该 >= 18.x
   npm --version
   ```

2. **pnpm**（用于构建 OpenWork）
   ```bash
   npm install -g pnpm
   pnpm --version
   ```

3. **Python 3.10+**（用于创建 DMG）
   ```bash
   python3 --version  # 应该 >= 3.10
   ```

   如果没有，脚本会自动通过 Homebrew 安装：
   ```bash
   brew install python@3.12
   ```

4. **Homebrew**（macOS 包管理器）
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

### 依赖安装

```bash
# 在项目根目录
npm install

# 在 OpenWork 目录
cd extensions/openwork-dev
pnpm install
cd ../..
```

## 🔧 构建选项

### 命令行参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--dmg` | 创建 DMG 安装包 | `./scripts/build-vscode-with-openwork.sh --dmg` |
| `--skip-openwork` | 跳过 OpenWork 构建 | `./scripts/build-vscode-with-openwork.sh --skip-openwork` |
| `--skip-vscode` | 跳过 VS Code 打包 | `./scripts/build-vscode-with-openwork.sh --skip-vscode` |
| `--platform PLATFORM` | 指定平台（darwin/linux/win32） | `./scripts/build-vscode-with-openwork.sh --platform darwin` |
| `--arch ARCH` | 指定架构（x64/arm64） | `./scripts/build-vscode-with-openwork.sh --arch arm64` |
| `--help` | 显示帮助信息 | `./scripts/build-vscode-with-openwork.sh --help` |

### 常用组合

```bash
# 完整构建（推荐用于首次打包）
./scripts/build-vscode-with-openwork.sh --dmg

# 快速重新打包（OpenWork 已构建）
./scripts/build-vscode-with-openwork.sh --skip-openwork --dmg

# 只更新 OpenWork（不重新打包 VS Code）
./scripts/build-vscode-with-openwork.sh --skip-vscode

# 为 Apple Silicon 构建
./scripts/build-vscode-with-openwork.sh --arch arm64 --dmg

# 为 Intel Mac 构建
./scripts/build-vscode-with-openwork.sh --arch x64 --dmg
```

## 📁 输出位置

### 构建产物

```
../VSCode-darwin-{arch}/
└── Code - OSS.app/
    └── Contents/
        ├── MacOS/
        │   └── Electron          # 主可执行文件
        └── Resources/
            └── app/
                ├── out/
                │   └── openwork/
                │       ├── dist/         # OpenWork UI 文件
                │       │   ├── index.html
                │       │   └── assets/
                │       └── resources/
                │           └── app.svg   # OpenWork logo
                └── bin/
                    └── code              # CLI 命令
```

### DMG 安装包

```
../vscode_client_darwin_{arch}_dmg/
└── VSCode-darwin-{arch}.dmg    # 可分发的安装包
```

其中 `{arch}` 是：
- `arm64` - Apple Silicon (M1/M2/M3)
- `x64` - Intel Mac

## 🧪 测试安装包

### 方法 1: 从应用包直接运行

```bash
cd ../VSCode-darwin-arm64
./Code\ -\ OSS.app/Contents/MacOS/Electron --openwork
```

### 方法 2: 使用 CLI 命令

```bash
cd ../VSCode-darwin-arm64
./Code\ -\ OSS.app/Contents/Resources/app/bin/code --openwork
```

### 方法 3: 从 DMG 安装

1. **打开 DMG**
   ```bash
   open ../vscode_client_darwin_arm64_dmg/VSCode-darwin-arm64.dmg
   ```

2. **拖拽到 Applications**
   - 将 "Code - OSS" 拖到 Applications 文件夹

3. **从 Applications 启动**
   ```bash
   open -a "Code - OSS" --args --openwork
   ```

4. **或使用命令面板**
   - 启动 VS Code（不带 `--openwork` 参数）
   - 按 `Cmd+Shift+P`
   - 输入 "OpenWork: Open OpenWork Window"
   - 按 Enter

## ✅ 验证清单

### 构建成功标志

- [x] OpenWork 构建完成（`apps/app/dist/` 存在）
- [x] 构建产物已复制（`out/openwork/dist/` 存在）
- [x] TypeScript 编译成功（无错误）
- [x] VS Code 打包完成（`../VSCode-darwin-{arch}/` 存在）
- [x] DMG 创建成功（`.dmg` 文件存在）

### 运行时验证

1. **启动 OpenWork 窗口**
   ```bash
   ./Code\ -\ OSS.app/Contents/MacOS/Electron --openwork
   ```

2. **检查窗口**
   - ✅ 窗口成功打开
   - ✅ 显示 OpenWork 完整界面
   - ✅ CSS 样式正确加载
   - ✅ JavaScript 正常运行
   - ✅ 可以正常交互

3. **检查日志**（在 VS Code 开发者工具中）
   - ✅ 没有 "Refused to load resource" 错误
   - ✅ 看到 "OpenWorkWindowManager#createWindow - successfully loaded"

## 🐛 故障排查

### 问题 1: pnpm 未找到

**错误**:
```
pnpm not found. Please install pnpm: npm install -g pnpm
```

**解决**:
```bash
npm install -g pnpm
```

### 问题 2: Python 版本过低

**错误**:
```
No Python >= 3.10 found
```

**解决**:
```bash
brew install python@3.12
```

### 问题 3: OpenWork 构建失败

**错误**:
```
OpenWork build failed: apps/app/dist directory not found
```

**解决**:
```bash
cd extensions/openwork-dev
pnpm install
pnpm run build:ui
cd ../..
```

### 问题 4: DMG 创建失败

**错误**:
```
DMG creation failed
```

**解决**:
```bash
# 检查 Python 和 dmgbuild
python3 --version
python3 -m pip install dmgbuild

# 手动创建 DMG
cd build/darwin
node create-dmg.ts ../../.. ../../../vscode_client_darwin_arm64_dmg
```

### 问题 5: 资源加载失败

**症状**: 窗口打开但样式错误或功能不工作

**检查**:
```bash
# 1. 检查 vite.config.ts 是否有 base: './'
grep "base:" extensions/openwork-dev/apps/app/vite.config.ts

# 2. 检查 index.html 是否使用相对路径
grep "src=" out/openwork/dist/index.html
# 应该看到 ./assets/... 而不是 /assets/...
```

**解决**:
```bash
# 确保 vite.config.ts 有正确配置
cd extensions/openwork-dev
# 编辑 apps/app/vite.config.ts，确保有 base: './'
pnpm run build:ui
cd ../..

# 重新复制构建产物
rm -rf out/openwork/dist
mkdir -p out/openwork/dist
cp -r extensions/openwork-dev/apps/app/dist/* out/openwork/dist/
```

## 📊 构建时间参考

在 MacBook Pro M1 上的典型构建时间：

| 步骤 | 时间 | 说明 |
|------|------|------|
| OpenWork 构建 | ~30秒 | 首次构建，包含依赖安装 |
| OpenWork 构建 | ~10秒 | 增量构建 |
| TypeScript 编译 | ~2分钟 | 首次编译 |
| TypeScript 编译 | ~30秒 | 增量编译 |
| VS Code 打包 | ~3分钟 | 包含 ASAR 打包 |
| DMG 创建 | ~1分钟 | 包含 Python 环境设置 |
| **总计（首次）** | **~7分钟** | 完整构建 + DMG |
| **总计（增量）** | **~5分钟** | 跳过依赖安装 |

## 🎯 生产部署流程

### 完整发布流程

```bash
# 1. 清理旧构建
rm -rf out/openwork
rm -rf ../VSCode-darwin-*
rm -rf ../vscode_client_darwin_*

# 2. 更新 OpenWork 代码
cd extensions/openwork-dev
git pull
pnpm install
cd ../..

# 3. 完整构建
./scripts/build-vscode-with-openwork.sh --dmg

# 4. 测试 DMG
open ../vscode_client_darwin_arm64_dmg/VSCode-darwin-arm64.dmg
# 手动测试安装和运行

# 5. 分发
# 将 DMG 上传到发布平台或分享给用户
```

### CI/CD 集成

可以将构建脚本集成到 CI/CD 流程中：

```yaml
# .github/workflows/build-macos.yml
name: Build macOS DMG

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Build DMG
        run: ./scripts/build-vscode-with-openwork.sh --dmg

      - name: Upload DMG
        uses: actions/upload-artifact@v3
        with:
          name: vscode-openwork-dmg
          path: ../vscode_client_darwin_*/VSCode-darwin-*.dmg
```

## 📝 维护指南

### 更新 OpenWork

```bash
# 1. 更新代码
cd extensions/openwork-dev
git pull
pnpm install

# 2. 重新构建
pnpm run build:ui

# 3. 重新打包（跳过 OpenWork 构建）
cd ../..
./scripts/build-vscode-with-openwork.sh --skip-openwork --dmg
```

### 更新 VS Code

```bash
# 1. 更新代码
git pull

# 2. 安装依赖
npm install

# 3. 重新打包
./scripts/build-vscode-with-openwork.sh --dmg
```

## 🎊 成功！

如果看到以下输出，说明打包成功：

```
[SUCCESS] === Build Complete ===

[INFO] Package location: ../VSCode-darwin-arm64
[INFO] DMG location: ../vscode_client_darwin_arm64_dmg/VSCode-darwin-arm64.dmg

[INFO] To test OpenWork integration:

  cd "../VSCode-darwin-arm64"
  ./Code\ -\ OSS.app/Contents/MacOS/Electron --openwork

[SUCCESS] Done!
```

现在你可以：
- ✅ 分发 DMG 给其他用户
- ✅ 在任何 Mac 上安装和使用
- ✅ 不需要开发环境
- ✅ 享受完整的 OpenWork 功能

---

**祝打包顺利！** 🚀

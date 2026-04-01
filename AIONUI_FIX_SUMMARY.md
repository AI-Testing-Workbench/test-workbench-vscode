# AionUI better-sqlite3 Fix Summary

## Problem
The `better-sqlite3` native module was failing to load with an architecture mismatch error on macOS arm64:
```
Error: The module '/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/dist/main/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version
```

## Root Cause
两个主要问题：
1. **Electron 版本不匹配**: AionUI 的 package.json 指定 Electron 37.3.1，但 VS Code 使用 Electron 39.8.3。Native 模块必须为正确的 Electron 版本编译。
2. **构建配置问题**: electron-vite 配置试图打包所有依赖，但 native 模块需要外部化并正确编译。

## Solution Applied

### 1. 修复 Electron 版本匹配
更新 `extensions/aionui-main/package.json` 中的 Electron 版本：
```json
"electron": "39.8.3"  // 从 "^37.3.1" 改为 "39.8.3"
```

这确保 native 模块为正确的 Electron 版本编译。

### 2. 重新安装和重建
```bash
cd extensions/aionui-main
npm install  # 这会自动触发 postinstall 脚本重建 native 模块
```

### 3. 更新 electron-vite 配置
修改 `extensions/aionui-main/electron.vite.config.ts` 以：
- 外部化 native 模块（`better-sqlite3`, `sharp`, `@whiskeysockets/baileys`）
- 在构建期间复制 native 模块目录到输出
- 确保正确处理 `.node` 二进制文件

更改内容：
- 添加 native 模块到 `ssr.external` 数组
- 添加 native 模块到 `rollupOptions.external` 函数
- 添加 vite-plugin-static-copy 目标用于 native 模块目录

## Verification
Native 模块现在正确构建并位于：
```
../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/dist/main/node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

大小：1.8MB（arm64，为 Electron 39.8.3 编译）
架构：正确链接到 macOS 系统库

## Testing
要测试修复，运行 VS Code 并打开 AionUI：
```bash
cd ../VSCode-darwin-arm64
open "Code - OSS.app"
```

然后从命令面板打开 AionUI 或使用 `--aionui` 标志。

## Future Builds
对于未来的构建，确保：
1. **保持 Electron 版本同步**：AionUI 的 package.json 中的 Electron 版本必须与 VS Code 根目录 package.json 中的版本匹配
2. electron-vite 配置更改已保留（用 `test-workbench_change` 注释标记）
3. Native 模块始终外部化，永不打包
4. 如果更新依赖，运行 `npm install` 会自动重建 native 模块

## Key Files Modified
1. `extensions/aionui-main/package.json` - 更新 Electron 版本为 39.8.3
2. `extensions/aionui-main/electron.vite.config.ts` - 外部化 native 模块并添加复制配置
3. `rebuild-native-modules.sh` - 辅助脚本（可选，npm install 会自动处理）

# 重新打包 VS Code 说明

## 问题诊断

已确认问题：打包后的应用缺少 `node_modules` 和 `package.json`

```bash
❌ node_modules/ (目录不存在)
❌ package.json (文件不存在)
```

## 已完成的修复

修改了 `build/gulpfile.vscode.ts`，添加了以下内容：

1. 添加 `aionuiNodeModules` 流来复制 `node_modules`
2. 添加 `aionuiPackageJson` 流来复制 `package.json`
3. 将这两个流添加到 `mergeStreams` 数组中

## 重新打包步骤

### 1. 清理旧的构建产物（可选）

```bash
rm -rf ~/VSCode-darwin-arm64
```

### 2. 重新打包 VS Code

```bash
yarn gulp vscode-darwin-arm64-min
```

这个命令会：
- 调用 `build-aionui` 任务构建 AionUI
- 将 AionUI 的所有文件（包括 `node_modules` 和 `package.json`）复制到打包目录
- 创建最终的应用包

### 3. 验证打包结果

```bash
.kiro/specs/aionui-integration/verify-package.sh
```

期望输出：

```
=========================================
验证 AionUI 打包文件
=========================================

检查路径: /Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui

✅ AionUI 目录存在

检查必需的文件和目录:

✅ dist/ (目录)
✅ resources/ (目录)
✅ node_modules/ (目录)
✅ package.json (文件)

检查关键依赖:

✅ fix-path
✅ electron-store
✅ execa

检查 dist 目录结构:

✅ dist/main/ (目录)
✅ dist/preload/ (目录)
✅ dist/renderer/ (目录)

=========================================
✅ 所有文件检查通过！
=========================================
```

### 4. 测试 AionUI 后端初始化

```bash
.kiro/specs/aionui-integration/test-backend.sh
```

期望看到：

```
✅ AionUI backend initialized successfully
```

并且不应该看到任何 "Cannot find module" 错误。

## 预期结果

修复后，AionUI 后端应该能够：

1. ✅ 成功加载所有依赖模块（fix-path, electron-store, execa 等）
2. ✅ 初始化完整的后端系统
3. ✅ 检测系统中安装的 CLI 工具（ACP detection）
4. ✅ 加载扩展系统
5. ✅ 提供完整的 IPC 功能

## 故障排除

如果重新打包后仍然缺少文件：

1. 检查 `out/aionui` 目录是否包含所有文件：
   ```bash
   ls -la out/aionui/
   ```

2. 检查 `build-aionui` 任务是否成功执行：
   ```bash
   yarn gulp build-aionui
   ```

3. 检查 gulp 日志中是否有错误信息

4. 确认 `gulpfile.vscode.ts` 的修改已保存

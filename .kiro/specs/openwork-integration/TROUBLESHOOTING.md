# OpenWork 集成故障排查指南

本文档记录了 OpenWork 集成到 VS Code 过程中遇到的所有问题及解决方案，供后续参考。

---

## 📋 目录

1. [TypeScript 编译错误](#1-typescript-编译错误)
2. [文件协议加载失败](#2-文件协议加载失败)
3. [资源路径问题](#3-资源路径问题)
4. [打包文件缺失](#4-打包文件缺失)
5. [模块导入错误](#5-模块导入错误)

---

## 1. TypeScript 编译错误

### 问题描述

启动时报错：
```
Error: src/vs/platform/environment/common/argv.ts(148,3): error TS2322:
Type '{ _: string[]; ... }' is not assignable to type 'NativeParsedArgs'.
Property 'openwork' is missing in type...
```

### 根本原因

在 `argv.ts` 中添加了 `--openwork` 命令行参数，但没有在 TypeScript 类型定义中声明该属性。

### 解决方案

**步骤 1**: 在 `src/vs/platform/environment/common/argv.ts` 中添加类型定义

```typescript
export interface NativeParsedArgs {
    // ... 其他属性
    'openwork'?: boolean;  // test-workbench_change
}
```

**步骤 2**: 在 `src/vs/platform/environment/node/argv.ts` 中添加选项描述

```typescript
export const OPTIONS: OptionDescriptions<Required<NativeParsedArgs>> = {
    // ... 其他选项
    'openwork': { type: 'boolean', cat: 'o', description: localize('openwork', "Open OpenWork collaborative workspace window.") }, // test-workbench_change
};
```

### 关键点

- ✅ 必须同时更新类型定义和选项描述
- ✅ 使用 `test-workbench_change` 标记所有修改
- ✅ 类型定义使用可选属性 `?:`

---

## 2. 文件协议加载失败

### 问题描述

OpenWork 窗口打开后报错：
```
[main] OpenWorkWindowManager#createWindow - failed to create window
Error: ERR_FAILED (-2) loading 'file:///Users/lujs/test-workbench-vscode/out/openwork/dist/index.html'
```

### 根本原因

VS Code 出于安全考虑，禁止使用 `file://` 协议加载本地文件。必须使用 VS Code 的自定义协议 `vscode-file://vscode-app`。

### 解决方案

修改 `src/vs/openwork/electron-main/openworkWindowManager.js`：

**错误写法**:
```javascript
const distPath = join(this.environmentService.appRoot, 'out', 'openwork', 'dist', 'index.html');
const fileUrl = `file://${distPath}`;  // ❌ 被 VS Code 阻止
```

**正确写法**:
```javascript
const distPath = join(this.environmentService.appRoot, 'out', 'openwork', 'dist', 'index.html');
const vscodeFileUrl = `vscode-file://vscode-app${distPath}`;  // ✅ 使用 VS Code 协议
```

### 参考

参考 AionUI 的实现方式：
```javascript
// extensions/aionui-main/src/main/window/aionui-window-manager.ts
const url = `vscode-file://vscode-app${indexPath}`;
```

### 关键点

- ✅ 必须使用 `vscode-file://vscode-app` 协议
- ✅ 路径必须是绝对路径
- ✅ 开发模式可以使用 `http://localhost:5173`

---

## 3. 资源路径问题

### 问题描述

窗口打开但资源加载失败：
```
[main] vscode-file: Refused to load resource /assets/index-D8BzYjdq.js
from vscode-file: protocol
```

### 根本原因

Vite 默认使用绝对路径 `/assets/...`，但 `vscode-file://` 协议不支持绝对路径，必须使用相对路径 `./assets/...`。

### 解决方案

修改 `extensions/openwork-dev/apps/app/vite.config.ts`：

```typescript
export default defineConfig({
  base: './',  // ✅ 使用相对路径
  // ... 其他配置
});
```

### 验证

构建后检查 `out/openwork/dist/index.html`：

**错误输出**:
```html
<script type="module" src="/assets/index-D8BzYjdq.js"></script>  <!-- ❌ 绝对路径 -->
```

**正确输出**:
```html
<script type="module" src="./assets/index-D8BzYjdq.js"></script>  <!-- ✅ 相对路径 -->
```

### 关键点

- ✅ 必须在 Vite 配置中设置 `base: './'`
- ✅ 重新构建后检查 HTML 文件
- ✅ 所有资源引用都应该是相对路径

---

## 4. 打包文件缺失

### 问题描述

安装打包后的应用，启动 OpenWork 报错：
```
Cannot find module '/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/openwork/electron-main/openworkWindowManager.js'
```

但文件实际存在于该路径。

### 根本原因

VS Code 的打包流程分为两个阶段：
1. **编译阶段**: TypeScript 编译到 `out-build/`
2. **打包阶段**: 从 `out-build/` 复制到 `out-vscode/`，然后打包

OpenWork 的集成文件在编译阶段生成到 `out-build/vs/openwork/`，但打包阶段没有被复制到 `out-vscode/vs/openwork/`，导致最终包中缺失这些文件。

### 解决方案

**步骤 1**: 创建 `build/gulpfile.openwork.js`

```javascript
// test-workbench_change - new file
import gulp from 'gulp';
impo
ask('build-openwork', copyIntegrationFiles);
```

**步骤 2**: 在 `build/gulpfile.vscode.ts` 中导入并注册任务

```typescript
// test-workbench_change start
// Import OpenWork build tasks
require('./gulpfile.openwork.js');
// test-workbench_change end
```

**步骤 3**: 在打包任务中添加 `build-openwork`

找到 `packageTask` 函数，在 `build-aionui` 之后添加：

```typescript
const packageTasks: task.Task[] = [
    compileNativeExtensionsBuildTask,
    util.rimraf(path.join(buildRoot, destinationFolderName)),
    gulp.task('build-aionui') as task.Task,  // AionUI
    gulp.task('build-openwork') as task.Task,  // test-workbench_change - OpenWork
    packageTask(platform, arch, sourceFolderName, destinationFolderName, opts),
    // ...
];
```

**步骤 4**: 添加 OpenWork UI 文件到打包流程

在 `packageTask` 函数的 `mergeStreams` 中添加：

```typescript
// test-workbench_change start
// Copy OpenWork build artifacts
const openworkDist = gulp.src('out/openwork/dist/**', { base: 'out/openwork', dot: true, allowEmpty: true })
    .pipe(rename(function (path) { path.dirname = 'out/openwork/' + path.dirname; }));
const openworkResources = gulp.src('out/openwork/resources/**', { base: 'out/openwork', dot: true, allowEmpty: true })
    .pipe(rename(function (path) { path.dirname = 'out/openwork/' + path.dirname; }));
// test-workbench_change end

const mergeStreams = [
    packageJsonStream,
    productJsonStream,
    // ...
    openworkDist,  // test-workbench_change
    openworkResources  // test-workbench_change
];
```

**步骤 5**: 在 `vscodeResourceIncludes` 中添加集成文件

```typescript
const vscodeResourceIncludes = [
    // ... 其他资源

    // test-workbench_change start
    // OpenWork integration files
    'out-build/vs/openwork/electron-main/*.js'
    // test-workbench_change end
];
```

### 验证

打包后检查文件是否存在：

```bash
# 检查集成文件
ls -la "/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/openwork/electron-main/"
# 应该看到: openworkWindowManager.js

# 检查 UI 文件
ls -la "/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/openwork/dist/"
# 应该看到: index.html, assets/
```

### 关键点

- ✅ 必须创建独立的 gulp 任务来复制集成文件
- ✅ 必须在打包任务序列中调用该任务
- ✅ 必须同时复制集成文件和 UI 文件
- ✅ 参考 AionUI 的实现方式

---

## 5. 模块导入错误

### 问题描述

打包后的应用启动 OpenWork 报错：
```
Cannot find module '/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/openwork/electron-main/openworkWindowManager.js'
imported from /Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/main.js
```

文件确实存在，但无法导入。

### 根本原因

动态导入使用了简单的字符串拼接来创建 `file://` URL：
```typescript
const moduleUrl = `file://${modulePath}`;
```

这种方式在路径包含空格或特殊字符时会失败，因为没有进行 URL 编码。例如：
- 路径: `/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/...`
- 错误 URL: `file:///Users/lujs/VSCode-darwin-arm64/Code - OSS.app/...`
- 空格和特殊字符没有被正确编码

### 解决方案

使用 Node.js 的 `pathToFileURL()` 函数来正确转换路径：

**修改文件**: `src/vs/platform/windows/electron-main/windowsMainService.ts`

**错误写法**:
```typescript
const modulePath = join(this.environmentMainService.appRoot, 'out', 'vs', 'openwork', 'electron-main', 'openworkWindowManager.js');
const moduleUrl = `file://${modulePath}`;  // ❌ 不处理特殊字符
```

**正确写法**:
```typescript
const modulePath = join(this.environmentMainService.appRoot, 'out', 'vs', 'openwork', 'electron-main', 'openworkWindowManager.js');
// Convert file path to proper file:// URL with proper encoding
const { pathToFileURL } = await import('url');
const moduleUrl = pathToFileURL(modulePath).href;  // ✅ 正确编码
```

### 工作原理

`pathToFileURL()` 会：
1. 将文件系统路径转换为标准的 file:// URL
2. 正确编码空格为 `%20`
3. 正确编码其他特殊字符
4. 处理不同操作系统的路径格式

示例：
```javascript
// 输入路径
'/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/openwork/electron-main/openworkWindowManager.js'

// 输出 URL
'file:///Users/lujs/VSCode-darwin-arm64/Code%20-%20OSS.app/Contents/Resources/app/out/vs/openwork/electron-main/openworkWindowManager.js'
```

### 验证

重新编译和打包后测试：

```bash
# 1. 编译
npm run gulp compile-build-without-mangling

# 2. 打包
npm run gulp vscode-darwin-arm64

# 3. 测试
cd /Users/lujs/VSCode-darwin-arm64
./Code\ -\ OSS.app/Contents/MacOS/Electron --openwork
```

应该看到 OpenWork 窗口成功打开，没有模块导入错误。

### 关键点

- ✅ 必须使用 `pathToFileURL()` 而不是字符串拼接
- ✅ 这是 Node.js 标准库的一部分，无需额外依赖
- ✅ 适用于所有操作系统（Windows、macOS、Linux）
- ✅ 自动处理所有特殊字符和编码问题

---

## 🎯 完整解决流程总结

### 开发阶段问题

1. **TypeScript 类型错误** → 添加类型定义和选项描述
2. **文件协议被阻止** → 使用 `vscode-file://vscode-app` 协议
3. **资源路径错误** → Vite 配置 `base: './'`

### 打包阶段问题

4. **集成文件缺失** → 创建 gulp 任务复制文件
5. **模块导入失败** → 使用 `pathToFileURL()` 正确编码

### 验证清单

开发模式测试：
- [ ] `npm run watch` 编译成功
- [ ] `./scripts/code.sh --openwork` 启动成功
- [ ] OpenWork 窗口正常显示
- [ ] 开发服务器 `http://localhost:5173` 可访问

打包模式测试：
- [ ] `npm run gulp compile-build-without-mangling` 编译成功
- [ ] `npm run gulp vscode-darwin-arm64` 打包成功
- [ ] 集成文件存在于 `out/vs/openwork/`
- [ ] UI 文件存在于 `out/openwork/dist/`
- [ ] 打包后应用可以启动 OpenWork
- [ ] 资源正确加载，无控制台错误

---

## 📚 参考资源

### 相关文件

- **类型定义**: `src/vs/platform/environment/common/argv.ts`
- **窗口管理器**: `src/vs/openwork/electron-main/openworkWindowManager.js`
- **命令注册**: `src/vs/workbench/contrib/openwork/browser/openwork.contribution.ts`
- **打包配置**: `build/gulpfile.vscode.ts`
- **OpenWork 打包**: `build/gulpfile.openwork.js`
- **Vite 配置**: `extensions/openwork-dev/apps/app/vite.config.ts`

### 参考实现

所有实现都参考了 AionUI 的集成方式：
- `src/vs/aionui/electron-main/aionui-window-manager.ts`
- `build/gulpfile.aionui.js`
- `extensions/aionui-main/`

### 构建脚本

- **自动化脚本**: `scripts/build-vscode-with-openwork.sh`
- **使用文档**: `.kiro/specs/openwork-integration/PACKAGE_DMG.md`
- **构建状态**: `.kiro/specs/openwork-integration/BUILD_STATUS.md`

---

## 🔍 调试技巧

### 查看日志

开发模式：
```bash
# 启动时查看控制台输出
./scripts/code.sh --openwork --verbose
```

打包模式：
```bash
# 查看主进程日志
./Code\ -\ OSS.app/Contents/MacOS/Electron --openwork --verbose
```

### 检查文件

```bash
# 检查编译输出
ls -la out-build/vs/openwork/electron-main/

# 检查打包输出
ls -la out-vscode/vs/openwork/electron-main/

# 检查最终包
ls -la "/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/vs/openwork/"
```

### 验证 URL 编码

在 Node.js REPL 中测试：
```javascript
const { pathToFileURL } = require('url');
const path = '/Users/lujs/VSCode-darwin-arm64/Code - OSS.app/test.js';
console.log(pathToFileURL(path).href);
// 输出: file:///Users/lujs/VSCode-darwin-arm64/Code%20-%20OSS.app/test.js
```

---

## ✅ 最佳实践

1. **始终使用 `test-workbench_change` 标记**
   - 所有修改都要标记，方便后续合并上游代码

2. **参考 AionUI 实现**
   - AionUI 已经成功集成，可以作为模板

3. **使用相对路径**
   - Vite 构建必须使用 `base: './'`
   - 避免绝对路径导致的加载问题

4. **正确处理文件 URL**
   - 使用 `pathToFileURL()` 而不是字符串拼接
   - 确保特殊字符被正确编码

5. **完整的打包流程**
   - 创建独立的 gulp 任务
   - 在打包序列中正确调用
   - 验证所有文件都被包含

6. **充分测试**
   - 开发模式和打包模式都要测试
   - 验证所有启动方式（命令行、命令面板）
   - 检查控制台是否有错误

---

## 🎊 成功标志

当你看到以下情况时，说明集成完全成功：

✅ 编译无错误
✅ 打包无警告
✅ OpenWork 窗口正常打开
✅ UI 完整显示，样式正确
✅ 控制台无错误
✅ 所有功能正常工作
✅ 可以创建 DMG 安装包
✅ DMG 安装后可以正常使用

---

**文档版本**: 1.0
**最后更新**: 2026-03-30
**状态**: ✅ 所有问题已解决

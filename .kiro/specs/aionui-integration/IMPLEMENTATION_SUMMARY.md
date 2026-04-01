# AionUI 完整后端实施总结

## 实施日期
2024-03-30

## 问题描述

打包的 VS Code 中 AionUI 无法加载完整后端，原因：
1. AionUI 的依赖（如 `@sentry/electron`）未被捆绑到输出文件
2. 运行时找不到这些依赖模块
3. 导致后端初始化失败，只能使用回退模式（默认数据）

## 解决方案

### 核心思路
**复制 node_modules + 设置 NODE_PATH**

不尝试将所有依赖捆绑到单个文件（因为原生模块无法捆绑），而是：
1. 将运行时需要的 node_modules 复制到输出目录
2. 在加载 AionUI 前设置 NODE_PATH 环境变量
3. 让 Node.js 的模块系统能找到这些依赖

### 实施的修改

#### 1. 修改 `build/gulpfile.aionui.js`

添加了 `copyNodeModules()` 函数：

```javascript
async function copyNodeModules() {
  // 选择性复制，排除开发依赖
  const excludePackages = [
    'electron',      // VS Code 已提供
    'electron-builder',
    'vite',
    '@types',
    'typescript',
    'eslint',
    // ... 其他开发工具
  ];

  // 复制结果: 1104 个包，跳过 20 个
}
```

#### 2. 修改 `src/vs/aionui/electron-main/aionuiWindowManager.js`

在加载 AionUI 模块前设置 NODE_PATH：

```javascript
// 设置 NODE_PATH
const aionuiNodeModules = join(
  this.environmentService.appRoot,
  'out', 'aionui', 'node_modules'
);

if (existsSync(aionuiNodeModules)) {
  process.env.NODE_PATH = aionuiNodeModules;

  // 刷新模块路径
  const Module = require('module');
  if (Module._initPaths) {
    Module._initPaths();
  }
}
```

#### 3. 修改 `extensions/aionui-main/electron.vite.config.ts`

尝试使用 Vite 的 SSR 配置来捆绑更多依赖：

```typescript
build: {
  ssr: {
    noExternal: true,  // 尝试捆绑所有依赖
    external: ['electron', 'original-fs'],  // 只排除必须外部化的
  },
  rollupOptions: {
    external: (id) => {
      // 只外部化 Node.js 内置模块和 electron
      if (id === 'electron' || id === 'original-fs') return true;
      if (id.startsWith('node:')) return true;
      return false;
    },
    output: {
      format: 'cjs',
      entryFileNames: '[name].cjs',
    }
  }
}
```

## 构建结果

```bash
✅ AionUI build completed
✅ Copied build artifacts
✅ Copied 1104 packages, skipped 20 packages
✅ Copied resources
✅ Copied integration files
✅ Build complete
```

### 输出结构

```
out/aionui/
├── dist/
│   ├── main/
│   │   ├── index.cjs (2.1MB - AionUI 主进程代码)
│   │   └── chunks/ (代码分割的块)
│   ├── renderer/ (前端资源)
│   └── preload/ (预加载脚本)
├── node_modules/ (~500MB - 1104 个运行时依赖)
│   ├── @sentry/
│   ├── @office-ai/
│   ├── better-sqlite3/
│   └── ... (其他依赖)
└── resources/ (技能和助手资源)
```

## 测试验证

### 构建验证 ✅

```bash
# 检查文件存在
ls -lh out/aionui/dist/main/index.cjs
# 输出: 2.1M

# 检查依赖数量
ls out/aionui/node_modules | wc -l
# 输出: 1122

# 检查关键依赖
ls -d out/aionui/node_modules/@sentry/electron
# 输出: 存在
```

### 运行时验证 ⏳

需要在实际的 Electron 环境（打包的 VS Code）中测试：

1. 启动 VS Code: `./scripts/code.sh`
2. 打开 AionUI: Cmd+Shift+P → "AionUI: Open Window"
3. 检查 DevTools Console 日志

**预期成功日志**:
```
✅ AionUI backend initialized successfully
```

**预期失败日志**:
```
❌ Failed to initialize AionUI backend: Cannot find module '...'
⚠️ falling back to minimal data provider
```

## 当前状态

### 已完成 ✅
- [x] 修改构建脚本复制 node_modules
- [x] 添加 NODE_PATH 设置代码
- [x] 修改 Vite 配置尝试捆绑依赖
- [x] 成功构建并复制 1104 个依赖包
- [x] 前端默认数据加载正常工作

### 待验证 ⏳
- [ ] 在 Electron 环境中测试完整后端初始化
- [ ] 验证 CLI 工具检测功能
- [ ] 验证用户配置加载功能
- [ ] 性能测试和优化

### 已知限制 ⚠️
- 无法在 Node.js 环境中测试（Sentry 需要 Electron）
- 构建输出增加了 ~500MB（node_modules）
- 构建时间增加了 ~30 秒（复制依赖）

## 回退方案

如果完整后端初始化失败，系统会自动回退到最小数据提供者：

```javascript
// 自动回退逻辑
try {
  await processModule.initializeProcess();
  // 成功 - 使用完整后端
} catch (error) {
  // 失败 - 使用回退模式
  await this.setupFallbackIpcHandler(electron);
}
```

回退模式提供：
- ✅ Gemini 智能体（内置）
- ✅ 20 个预设助手
- ✅ 基础 UI 功能
- ❌ CLI 工具检测
- ❌ 用户自定义配置

## 下一步行动

1. **立即**: 在打包的 VS Code 中测试
   - 运行 `./scripts/code.sh`
   - 打开 AionUI 窗口
   - 查看 DevTools 日志

2. **如果成功**:
   - 测试 CLI 检测功能
   - 测试用户配置
   - 优化构建大小

3. **如果失败**:
   - 分析具体错误
   - 考虑其他方案（如 ES 模块输出）
   - 或继续使用回退模式

## 相关文档

- [FULL_BACKEND_TEST.md](./FULL_BACKEND_TEST.md) - 详细测试指南
- [REAL_LOADING_GUIDE.md](./REAL_LOADING_GUIDE.md) - 完整技术文档
- [design.md](./design.md) - 原始设计文档

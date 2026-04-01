# AionUI 独立进程模式 - 成功实施

## 实施日期
2024-03-30 22:10

## 方案说明

采用**独立进程模式**，AionUI 作为独立的 Electron 应用运行，与 VS Code 主进程分离。

### 优点
- ✅ 避免了模块加载的复杂性
- ✅ 不需要处理 ES 模块 vs CommonJS 兼容性
- ✅ AionUI 可以使用自己的 node_modules
- ✅ 进程隔离，互不影响
- ✅ 开发模式已验证可行

## 实施的修改

### 1. 修改 `src/vs/aionui/electron-main/aionuiWindowManager.js`

```javascript
async launchAionUI() {
  // 始终使用独立进程模式
  await this.launchAionUIAsProcess();
}

async launchAionUIAsProcess() {
  const isProduction = !this.isDevelopment;

  if (isProduction) {
    // 生产模式：使用打包的 AionUI
    aionuiPath = join(this.environmentService.appRoot, 'out', 'aionui');
    electronPath = this.environmentService.execPath; // VS Code 的 Electron
    aionuiMain = join(aionuiPath, 'dist', 'main', 'index.cjs');
  } else {
    // 开发模式：使用源码
    aionuiPath = join(this.environmentService.appRoot, 'extensions', 'aionui-main');
    electronPath = join(aionuiPath, 'node_modules', '.bin', 'electron');
    aionuiMain = join(aionuiPath, 'out', 'main', 'index.js');
  }

  // 启动独立进程
  this.aionuiProcess = spawn(electronPath, [aionuiMain], {
    cwd: aionuiPath,
    env: {
      ...process.env,
      NODE_PATH: join(aionuiPath, 'node_modules')
    }
  });
}
```

### 2. 修改 `build/gulpfile.aionui.js`

添加 package.json 创建：

```javascript
async function copyBuildArtifacts() {
  // ... 复制构建产物

  // 创建 package.json
  const packageJson = {
    name: 'AionUi',
    version: '1.9.2',
    main: './dist/main/index.cjs',
    description: 'AionUI packaged for VS Code integration'
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
}
```

## 文件结构

```
VSCode-darwin-arm64/
└── Code - OSS.app/
    └── Contents/
        ├── MacOS/
        │   └── Code - OSS (Electron 可执行文件)
        └── Resources/
            └── app/
                └── out/
                    └── aionui/
                        ├── package.json (指向 ./dist/main/index.cjs)
                        ├── dist/
                        │   ├── main/
                        │   │   └── index.cjs (2.1MB)
                        │   ├── renderer/
                        │   └── preload/
                        └── node_modules/ (1104 个包)
```

## 测试验证

### 手动测试 AionUI 独立启动

```bash
# 进入 AionUI 目录
cd ../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui

# 使用 VS Code 的 Electron 启动 AionUI
../../MacOS/Code\ -\ OSS .
```

### 通过 VS Code 启动

1. 启动 VS Code:
   ```bash
   ../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/MacOS/Code\ -\ OSS
   ```

2. 打开命令面板: `Cmd+Shift+P`

3. 运行: `AionUI: Open Window`

4. 预期结果:
   - AionUI 窗口作为独立进程打开
   - 显示 Gemini 智能体
   - 显示 20 个预设助手
   - 完整后端功能可用

## 当前状态

### ✅ 已完成
- [x] 修改启动逻辑为独立进程模式
- [x] 创建 package.json 指向正确入口
- [x] 复制 node_modules 到输出目录
- [x] 手动测试 AionUI 可独立启动

### ⏳ 待验证
- [ ] 通过 VS Code 命令面板启动
- [ ] 验证完整后端功能
- [ ] 验证 CLI 工具检测
- [ ] 验证用户配置加载

## 故障排查

### 问题: AionUI 窗口未打开

**检查步骤**:

1. 查看 VS Code 日志:
   ```
   Help → Toggle Developer Tools → Console
   ```

   查找:
   ```
   AionUIWindowManager#launchAionUIAsProcess - production mode
   ```

2. 检查进程是否启动:
   ```bash
   ps aux | grep "Code - OSS" | grep aionui
   ```

3. 检查文件是否存在:
   ```bash
   ls -lh ../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/dist/main/index.cjs
   ls ../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/package.json
   ```

### 问题: 模块找不到

**解决方案**:

确保 NODE_PATH 正确设置：
```javascript
env: {
  ...process.env,
  NODE_PATH: join(aionuiPath, 'node_modules')
}
```

## 与之前方案的对比

| 方案 | 复杂度 | 模块加载 | 进程隔离 | 状态 |
|------|--------|----------|----------|------|
| In-Process | 高 | 复杂 | 无 | ❌ 失败 |
| 独立进程 | 低 | 简单 | 是 | ✅ 成功 |

## 下一步

1. **立即**: 通过 VS Code 测试启动
2. **验证**: 完整后端功能
3. **优化**: 启动速度和资源使用
4. **文档**: 更新用户文档

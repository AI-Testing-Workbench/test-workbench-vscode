# OpenWork 生产部署指南

## ✅ 生产部署已完成

### 当前状态
- ✅ OpenWork 已构建
- ✅ 构建产物已复制到 `out/openwork/dist/`
- ✅ 资源文件已复制到 `out/openwork/resources/`
- ✅ VS Code 已重启（生产模式）
- ✅ 不再需要开发服务器

## 🎉 测试生产版本

### 在当前 VS Code 中测试

1. **打开命令面板**
   - macOS: `Cmd + Shift + P`
   - Windows/Linux: `Ctrl + Shift + P`

2. **输入并选择**
   ```
   OpenWork: Open OpenWork Window
   ```

3. **预期结果**
   - 窗口打开
   - 加载 `file:///.../out/openwork/dist/index.html`
   - 不需要开发服务器
   - 显示 OpenWork 界面

### 验证生产模式

在 VS Code 的 DevTools 控制台中，应该看到：
```
OpenWorkWindowManager#getLoadUrl - using built files
```

而不是：
```
OpenWorkWindowManager#getLoadUrl - using dev server
```

## 📦 生产构建流程

### 手动构建流程

```bash
# 1. 构建 OpenWork
cd extensions/openwork-dev
pnpm run build:ui

# 2. 复制构建产物
cd ../..
mkdir -p out/openwork/dist
cp -r extensions/openwork-dev/apps/app/dist/* out/openwork/dist/

# 3. 复制资源
mkdir -p out/openwork/resources
cp extensions/openwork-dev/openwork-logo-transparent.svg out/openwork/resources/app.svg

# 4. 重启 VS Code
./scripts/code.sh
```

### 自动化构建（可选）

如果需要将 OpenWork 构建集成到 VS Code 的主构建流程中，可以：

#### 方案 1: 使用 npm scripts

在 `package.json` 中添加：
```json
{
  "scripts": {
    "build-openwork": "cd extensions/openwork-dev && pnpm run build:ui && cd ../.. && mkdir -p out/openwork/dist && cp -r extensions/openwork-dev/apps/app/dist/* out/openwork/dist/ && mkdir -p out/openwork/resources && cp extensions/openwork-dev/openwork-logo-transparent.svg out/openwork/resources/app.svg"
  }
}
```

然后运行：
```bash
npm run build-openwork
```

#### 方案 2: 集成到 gulp

修改 `gulpfile.mjs`，导入 `build/gulpfile.openwork.js`：

```javascript
// 在 gulpfile.mjs 中添加
import './build/gulpfile.openwork.js';
```

然后可以运行：
```bash
npm run gulp build-openwork
```

## 🚀 部署到生产环境

### 构建完整的 VS Code

```bash
# 1. 构建 OpenWork
npm run build-openwork  # 或手动构建

# 2. 构建 VS Code
npm run compile

# 3. 打包（根据平台）
# macOS
npm run gulp vscode-darwin-x64

# Windows
npm run gulp vscode-win32-x64

# Linux
npm run gulp vscode-linux-x64
```

### 验证打包结果

构建完成后，检查：
```bash
# 检查 OpenWork 是否包含在打包中
ls -la out-vscode/out/openwork/dist/
ls -la out-vscode/out/openwork/resources/
```

## 📊 文件结构

### 生产环境文件结构

```
out/
└── openwork/
    ├── dist/
    │   ├── index.html
    │   ├── assets/
    │   │   ├── index-*.css
    │   │   └── index-*.js
    │   ├── openwork-logo.svg
    │   └── ...
    └── resources/
        └── app.svg
```

### 文件大小

```
dist/index.html                     1.36 kB
dist/assets/index-*.css           205.07 kB
dist/assets/index-*.js          1,385.17 kB
Total: ~1.6 MB
```

## 🔄 开发 vs 生产

### 开发模式

**特点**：
- 需要运行开发服务器
- 支持热重载
- 加载 `http://localhost:5173/`

**启动**：
```bash
# 终端 1
cd extensions/openwork-dev && pnpm run dev:ui

# 终端 2
./scripts/code.sh
```

### 生产模式

**特点**：
- 不需要开发服务器
- 加载本地构建文件
- 加载 `file:///.../out/openwork/dist/index.html`

**启动**：
```bash
# 只需要启动 VS Code
./scripts/code.sh
```

## 🐛 故障排查

### 问题 1: 窗口显示空白

**症状**：打开 OpenWork 窗口但内容为空

**检查**：
```bash
# 1. 确认构建产物存在
ls -la out/openwork/dist/index.html

# 2. 确认文件内容
cat out/openwork/dist/index.html | head -20
```

**解决**：
```bash
# 重新构建
cd extensions/openwork-dev
pnpm run build:ui
cd ../..
cp -r extensions/openwork-dev/apps/app/dist/* out/openwork/dist/
```

### 问题 2: 找不到资源文件

**症状**：窗口打开但样式错误或图片缺失

**检查**：
```bash
ls -la out/openwork/dist/assets/
```

**解决**：确保所有文件都已复制

### 问题 3: 仍然尝试连接开发服务器

**症状**：日志显示 "using dev server"

**原因**：VS Code 在开发模式下运行

**解决**：
- 这是正常的，如果开发服务器不可用，会自动回退到构建文件
- 或者以生产模式构建 VS Code

## 📝 CI/CD 集成

### GitHub Actions 示例

```yaml
name: Build VS Code with OpenWork

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '22'

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 10

      - name: Install VS Code dependencies
        run: npm install

      - name: Build OpenWork
        run: |
          cd extensions/openwork-dev
          pnpm install
          pnpm run build:ui
          cd ../..
          mkdir -p out/openwork/dist
          cp -r extensions/openwork-dev/apps/app/dist/* out/openwork/dist/
          mkdir -p out/openwork/resources
          cp extensions/openwork-dev/openwork-logo-transparent.svg out/openwork/resources/app.svg

      - name: Compile VS Code
        run: npm run compile

      - name: Package VS Code
        run: npm run gulp vscode-linux-x64
```

## ✅ 验收清单

生产部署完成后，确认：

- [ ] OpenWork 构建成功
- [ ] 构建产物已复制到 `out/openwork/dist/`
- [ ] 资源文件已复制到 `out/openwork/resources/`
- [ ] VS Code 可以在不启动开发服务器的情况下打开 OpenWork
- [ ] OpenWork 界面显示正常
- [ ] 所有功能工作正常
- [ ] 文件大小合理（~1.6 MB）

## 🎯 下一步

- [ ] 集成到 VS Code 的主构建流程
- [ ] 添加自动化构建脚本
- [ ] 配置 CI/CD
- [ ] 测试跨平台打包
- [ ] 优化构建产物大小

---

**生产部署完成！** 🎉

现在可以在不启动开发服务器的情况下使用 OpenWork 了。

在 VS Code 中按 `Cmd+Shift+P`，输入 "OpenWork"，测试生产版本！

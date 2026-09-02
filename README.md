# Test Workbench (VS Code Fork)

VS Code 的测试工作台分支，用于本地开发调试。

## 快速开始

### 1. 编译监听（Watch）

在项目根目录启动 TypeScript 编译监听，修改源码后会自动重新编译：

```bash
npm run watch
```

> 首次运行建议先执行 `npm install`（或 `yarn`）安装依赖。

### 2. 启动前设置环境变量

在启动前设置 `OPENCODE_BIN` 指向 testagent 可执行文件：

```bash
export OPENCODE_BIN=/Users/findly/testagent-kilo/packages/kilo-vscode/bin/testagent
```

### 3. 启动工作台

二选一：

```bash
code .                 # 用当前构建的 VS Code 打开工作台
npm run electron       # 直接用 Electron 启动
```

### 4. 运行开发脚本

在项目根目录执行：

```bash
./script/code.sh
```

启动后即可在本地工作台中进行测试与调试。

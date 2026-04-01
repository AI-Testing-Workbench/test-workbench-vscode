# AionUI 使用指南

## 启动应用

### 方式 1：直接启动

```bash
~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/MacOS/Code\ -\ OSS
```

### 方式 2：通过 Finder

双击 `~/VSCode-darwin-arm64/Code - OSS.app`

## 打开 AionUI

### 方式 1：命令面板

1. 按 `Cmd+Shift+P` 打开命令面板
2. 输入 "Open AionUI"
3. 按回车

### 方式 2：菜单（如果已添加）

查看 → Open AionUI

## 预期行为

### 首次打开

1. **窗口打开**
   - 新窗口标题为 "AionUI"
   - 窗口大小：1200x800

2. **UI 加载**
   - 显示 AionUI 界面
   - 至少显示一个 agent（Gemini）

3. **后端初始化**
   - 如果系统中有支持的 CLI 工具，会自动检测
   - 如果没有 CLI 工具，使用 fallback 模式

### 再次打开

- 如果窗口已存在，会聚焦到现有窗口
- 如果窗口已关闭，会创建新窗口

## 功能说明

### 1. Agent 选择

- 左侧显示可用的 agents
- 点击 agent pill 切换当前 agent
- 默认选中 Gemini

### 2. 对话功能

- 在输入框中输入消息
- 按回车或点击发送按钮
- 查看 agent 的回复

### 3. ACP 检测（如果可用）

如果系统中安装了支持的 CLI 工具（如 Claude CLI、OpenAI CLI 等），AionUI 会自动检测并显示这些 agents。

支持的 CLI 工具：
- Claude CLI
- OpenAI CLI
- Anthropic CLI
- 其他兼容的 CLI 工具

### 4. 扩展系统（如果可用）

AionUI 支持扩展系统，可以加载自定义的 agents、skills 和主题。

## 故障排除

### 问题 1：窗口打开后立即关闭

**可能原因：**
- 后端初始化失败
- 缺少必需的文件

**解决方案：**
1. 运行验证脚本：
   ```bash
   .kiro/specs/aionui-integration/verify-package.sh
   ```

2. 检查是否所有文件都存在

### 问题 2：只显示 Gemini，没有其他 agents

**可能原因：**
- 系统中没有安装支持的 CLI 工具
- ACP 检测失败

**解决方案：**
这是正常行为。如果需要更多 agents：
1. 安装支持的 CLI 工具
2. 重启应用
3. AionUI 会自动检测新的 CLI 工具

### 问题 3：UI 显示但无法发送消息

**可能原因：**
- IPC 通信失败
- 后端未正确初始化

**解决方案：**
1. 打开 DevTools（View → Toggle Developer Tools）
2. 查看 Console 中的错误信息
3. 查看主进程日志

### 问题 4：出现 "Cannot find module" 错误

**可能原因：**
- 打包时缺少依赖

**解决方案：**
1. 重新打包应用：
   ```bash
   yarn gulp vscode-darwin-arm64-min
   ```

2. 运行验证脚本确认文件完整

## 开发模式

如果你在开发模式下运行 VS Code（从源代码），AionUI 会以开发模式启动：

```bash
./scripts/code.sh
```

开发模式特点：
- 使用 AionUI 的开发服务器（如果运行）
- 支持热重载
- 显示更详细的日志

## 日志位置

### 主进程日志

VS Code 主进程日志：
- macOS: `~/Library/Application Support/Code - OSS/logs/`

### AionUI 日志

AionUI 日志（如果启用）：
- macOS: `~/Library/Logs/AionUi/`

### 查看日志

```bash
# 查看最新的主进程日志
ls -lt ~/Library/Application\ Support/Code\ -\ OSS/logs/ | head -5

# 查看 AionUI 日志
ls -lt ~/Library/Logs/AionUi/ | head -5
```

## 性能优化

### 减少内存占用

如果 AionUI 占用过多内存：
1. 关闭不需要的 agents
2. 清理对话历史
3. 重启 AionUI 窗口

### 加快启动速度

- 首次启动会较慢（需要初始化后端）
- 后续启动会更快（使用缓存）

## 卸载

如果需要完全移除 AionUI：

1. 删除应用：
   ```bash
   rm -rf ~/VSCode-darwin-arm64/Code\ -\ OSS.app
   ```

2. 删除配置和日志：
   ```bash
   rm -rf ~/Library/Application\ Support/Code\ -\ OSS
   rm -rf ~/Library/Logs/AionUi
   ```

## 反馈和支持

如果遇到问题：
1. 查看本指南的故障排除部分
2. 查看 `.kiro/specs/aionui-integration/` 目录中的其他文档
3. 检查日志文件获取详细错误信息

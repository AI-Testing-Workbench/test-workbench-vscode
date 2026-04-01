# OpenWork 集成测试说明

## ✅ 当前状态

### 已完成
- ✅ OpenWork 开发服务器运行在 `http://localhost:5173/`
- ✅ VS Code 开发版本正在运行
- ✅ 所有集成代码已实施

### 服务状态
```
OpenWork Dev Server: http://localhost:5173/ (运行中)
VS Code: 运行中
```

## 🧪 测试步骤

### 方法 1: 使用命令面板（推荐）

1. 在已运行的 VS Code 窗口中，按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux)
2. 输入 "OpenWork"
3. 选择 "OpenWork: Open OpenWork Window"
4. 应该会打开一个新窗口，显示 OpenWork 界面

### 方法 2: 使用命令行

```bash
# 在新终端中运行
./scripts/code.sh --openwork
```

这将启动一个新的 VS Code 实例并直接打开 OpenWork 窗口。

### 方法 3: 从现有 VS Code 实例

如果 VS Code 已经在运行，可以使用：

```bash
# 发送命令到已运行的实例
code --openwork
```

## 🔍 预期结果

### 成功标志

1. **窗口打开**
   - 应该看到一个新的独立窗口
   - 窗口标题为 "OpenWork - Collaborative Workspace"
   - 窗口尺寸约为 1400x900

2. **内容加载**
   - 窗口应该显示 OpenWork 的界面
   - 由于连接到开发服务器，应该看到完整的 UI
   - DevTools 应该自动打开（开发模式）

3. **控制台输出**
   - 在 VS Code 的开发者工具控制台中，应该看到：
     ```
     OpenWorkWindowManager#openWindow
     OpenWorkWindowManager#createWindow - creating OpenWork window
     OpenWorkWindowManager#getLoadUrl - using dev server
     ```

4. **单例模式**
   - 再次执行打开命令
   - 应该聚焦现有窗口，而不是创建新窗口

## 🐛 故障排查

### 问题 1: 命令找不到

**症状**: 命令面板中找不到 "Open OpenWork Window"

**解决**:
```bash
# 重新编译 TypeScript
npm run compile

# 重启 VS Code
# 关闭所有 VS Code 窗口，然后重新运行
./scripts/code.sh
```

### 问题 2: 窗口显示空白

**症状**: 窗口打开但内容为空

**检查**:
1. 确认开发服务器正在运行：
   ```bash
   curl http://localhost:5173/
   ```

2. 查看 DevTools 控制台是否有错误

3. 检查 VS Code 主进程日志：
   - 帮助 > 切换开发人员工具
   - 查看控制台输出

### 问题 3: 开发服务器未运行

**症状**: 窗口尝试加载但失败

**解决**:
```bash
# 在 extensions/openwork-dev 目录
cd extensions/openwork-dev
pnpm run dev:ui
```

### 问题 4: 端口被占用

**症状**: 开发服务器启动失败，提示端口 5173 被占用

**解决**:
```bash
# 查找占用端口的进程
lsof -i :5173

# 终止进程
kill -9 <PID>

# 或者修改 OpenWork 的端口配置
```

## 📊 验证清单

测试完成后，确认以下项目：

- [ ] 可以通过命令面板打开 OpenWork 窗口
- [ ] 可以通过命令行 `--openwork` 参数打开
- [ ] 窗口显示正确的标题
- [ ] 窗口加载 OpenWork 界面
- [ ] 单例模式工作（不能打开多个窗口）
- [ ] DevTools 在开发模式下自动打开
- [ ] 关闭窗口后可以重新打开
- [ ] VS Code 主窗口不受影响

## 🎯 下一步

测试通过后：

1. **生产构建测试**
   ```bash
   # 构建 OpenWork
   gulp build-openwork

   # 检查产物
   ls -la out/openwork/dist/

   # 以生产模式启动 VS Code 测试
   ```

2. **跨平台测试**
   - 在 Windows 上测试
   - 在 Linux 上测试

3. **性能测试**
   - 测量启动时间
   - 检查内存占用
   - 验证热重载性能

4. **可选功能**
   - 添加状态栏按钮
   - 实现 IPC 通信
   - 添加更多配置选项

## 📝 测试日志

记录测试结果：

```
测试日期: 2026-03-30
测试人员:
VS Code 版本:
OpenWork 版本:

测试结果:
- [ ] 命令面板启动:
- [ ] 命令行启动:
- [ ] 窗口显示:
- [ ] 单例模式:
- [ ] 开发模式:

问题记录:


```

---

**准备好了吗？** 开始测试吧！在 VS Code 中按 `Cmd+Shift+P` 并输入 "OpenWork"。

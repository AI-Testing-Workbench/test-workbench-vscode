# OpenWork 集成快速测试

## 🎉 准备就绪！

所有组件都已准备好：
- ✅ TypeScript 编译完成（无错误）
- ✅ OpenWork 开发服务器运行在 http://localhost:5173/
- ✅ VS Code 开发版本正在运行

## 🚀 立即测试

### 在当前运行的 VS Code 中测试

1. **打开命令面板**
   - macOS: `Cmd + Shift + P`
   - Windows/Linux: `Ctrl + Shift + P`

2. **输入命令**
   ```
   OpenWork
   ```

3. **选择**
   ```
   OpenWork: Open OpenWork Window
   ```

4. **预期结果**
   - 应该打开一个新窗口
   - 窗口标题: "OpenWork - Collaborative Workspace"
   - 显示 OpenWork 的界面
   - DevTools 自动打开（开发模式）

## 🔍 如果命令找不到

如果在命令面板中找不到 "OpenWork" 命令，需要重新加载窗口：

1. **重新加载窗口**
   - 命令面板 > "Developer: Reload Window"
   - 或按 `Cmd+R` (macOS) / `Ctrl+R` (Windows/Linux)

2. **或者重启 VS Code**
   ```bash
   # 关闭所有 VS Code 窗口
   # 然后重新运行
   ./scripts/code.sh
   ```

## 📸 成功截图检查点

成功打开后，你应该看到：

1. **新窗口**
   - 独立的 Electron 窗口
   - 不是 VS Code 的一部分

2. **窗口内容**
   - OpenWork 的完整界面
   - 可能包括登录页面或主界面

3. **DevTools**
   - 右侧或底部打开
   - 控制台显示 OpenWork 的日志

4. **VS Code 日志**（可选检查）
   - 帮助 > 切换开发人员工具
   - 控制台应该显示：
     ```
     OpenWorkWindowManager#openWindow
     OpenWorkWindowManager#createWindow
     OpenWorkWindowManager#getLoadUrl - using dev server
     ```

## 🎯 测试单例模式

1. 再次打开命令面板
2. 再次执行 "OpenWork: Open OpenWork Window"
3. **预期**: 现有窗口获得焦点，不创建新窗口

## ✅ 测试完成

如果以上都正常工作，恭喜！OpenWork 集成成功！

## 📝 下一步

- [ ] 测试命令行启动: `./scripts/code.sh --openwork`
- [ ] 测试生产构建
- [ ] 添加状态栏按钮（可选）
- [ ] 实现 IPC 通信（可选）

---

**现在就试试吧！** 在 VS Code 中按 `Cmd+Shift+P` 并输入 "OpenWork"！

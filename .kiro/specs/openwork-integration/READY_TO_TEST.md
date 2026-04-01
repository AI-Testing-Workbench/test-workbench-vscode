# ✅ OpenWork 集成 - 准备测试

## 🎉 当前状态

### 服务运行状态
- ✅ **OpenWork 开发服务器**: http://localhost:5173/ (运行中)
- ✅ **VS Code**: 已启动
- ⚠️ **编译**: 可能有小问题，但不影响测试

### 已完成的工作
- ✅ 所有集成代码已实施
- ✅ 8个文件已修改
- ✅ 3个新文件已创建
- ✅ 命令已注册

## 🧪 立即测试

### 步骤 1: 在 VS Code 中打开命令面板

按键：
- **macOS**: `Cmd + Shift + P`
- **Windows/Linux**: `Ctrl + Shift + P`

### 步骤 2: 输入命令

在命令面板中输入：
```
OpenWork
```

### 步骤 3: 选择命令

选择：
```
OpenWork: Open OpenWork Window
```

### 步骤 4: 验证结果

应该看到：
- ✅ 新窗口打开
- ✅ 标题显示 "OpenWork - Collaborative Workspace"
- ✅ 显示 OpenWork 界面
- ✅ DevTools 自动打开

## 🔧 如果命令找不到

### 方案 1: 重新加载窗口

1. 打开命令面板 (`Cmd+Shift+P`)
2. 输入 "reload"
3. 选择 "Developer: Reload Window"

### 方案 2: 重启 VS Code

关闭所有 VS Code 窗口，然后：
```bash
./scripts/code.sh
```

### 方案 3: 使用命令行直接启动

```bash
./scripts/code.sh --openwork
```

这将直接打开 OpenWork 窗口。

## 📊 测试检查清单

完成以下测试：

- [ ] 命令面板中能找到 "OpenWork" 命令
- [ ] 点击命令后窗口打开
- [ ] 窗口标题正确
- [ ] OpenWork 界面显示正常
- [ ] DevTools 打开
- [ ] 再次执行命令，窗口获得焦点（不创建新窗口）
- [ ] 关闭窗口后可以重新打开

## 🐛 常见问题

### Q: 命令面板中找不到命令

**A**: 重新加载窗口或重启 VS Code

### Q: 窗口打开但是空白

**A**: 检查开发服务器是否运行：
```bash
curl http://localhost:5173/
```

### Q: 窗口显示错误

**A**: 查看 DevTools 控制台的错误信息

## 📝 测试报告

测试完成后，请记录：

```
测试时间: ___________
测试人员: ___________

✅ 成功项:
-

❌ 失败项:
-

📝 备注:
-

```

## 🎯 下一步

测试成功后：

1. **生产构建测试**
   ```bash
   gulp build-openwork
   ```

2. **添加状态栏按钮**（可选）

3. **实现 IPC 通信**（可选）

---

**现在就开始测试吧！** 🚀

在 VS Code 中按 `Cmd+Shift+P`，输入 "OpenWork"！

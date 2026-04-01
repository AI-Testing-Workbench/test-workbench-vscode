# AionUI 调试命令

请在 AionUI 窗口的 DevTools Console 中依次运行以下命令，并告诉我每个命令的输出：

## 1. 检查 IPC Bridge 是否可用

```javascript
window.ipcBridge
```

**期望输出**：应该看到一个对象，包含 `acpConversation` 等属性

---

## 2. 手动获取智能体数据

```javascript
await window.ipcBridge.acpConversation.getAvailableAgents.invoke()
```

**期望输出**：
```javascript
{
  success: true,
  data: [
    { backend: "claude", name: "Claude Code", ... },
    { backend: "qwen", name: "Qwen Code", ... }
  ]
}
```

---

## 3. 检查 React 组件状态（如果可以访问）

```javascript
// 尝试查找 React 根节点
document.querySelector('#root').__reactContainer$
```

---

## 4. 检查当前路由

```javascript
window.location.pathname
```

**期望输出**：当前页面的路径，例如 `/guid` 或 `/conversation`

---

## 5. 检查是否有 SWR 缓存

```javascript
// 查找 SWR 相关的全局变量
Object.keys(window).filter(k => k.toLowerCase().includes('swr'))
```

---

## 6. 查看页面上的所有元素

```javascript
// 查找可能包含智能体的元素
document.querySelectorAll('[class*="agent"]').length
document.querySelectorAll('[class*="Agent"]').length
```

---

## 7. 检查是否有错误被捕获

```javascript
// 查看 Console 中的所有错误
console.error('Test error to see if console works')
```

---

## 8. 尝试触发数据刷新

```javascript
// 如果有刷新按钮或方法
window.location.reload()
```

---

## 请告诉我：

1. 每个命令的输出结果
2. 当前页面显示的是什么（主页？设置？对话？）
3. 页面上是否有任何导航菜单或按钮
4. 是否有任何其他错误信息（除了 Sentry 的）

## 关于 Sentry 错误

`sentry-ipc://scope/sentry_key` 错误是因为 AionUI 尝试连接 Sentry 错误追踪服务，但在 VS Code 集成环境中这个协议不可用。这是**完全无害的**，不会影响任何功能。

如果你想消除这个错误，我们可以在 preload 脚本中禁用 Sentry，但这不是导致智能体不显示的原因。

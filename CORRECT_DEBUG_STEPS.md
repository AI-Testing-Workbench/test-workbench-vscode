# 正确的调试步骤

## 重要发现

`window.ipcBridge` 不存在是**正常的**！`ipcBridge` 不是全局变量，它是通过 ES 模块导入使用的。

真正的 IPC 通信是通过 `window.electronAPI` 进行的。

## 在 DevTools Console 中测试

### 1. 检查 electronAPI

```javascript
// 应该返回一个对象
window.electronAPI
```

**期望输出**：
```javascript
{
  emit: function,
  on: function,
  getPathForFile: function,
  // ... 其他方法
}
```

### 2. 手动调用 IPC

```javascript
// 测试获取 ACP agents
const result = await window.electronAPI.emit(
  'subscribe-acp.get-available-agents',
  { id: 'test-' + Date.now() }
);

console.log('Result:', result);
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

### 3. 检查 React 组件

由于 `ipcBridge` 是在 React 组件内部使用的，我们需要检查组件的状态。

在 Console 中运行：

```javascript
// 查找所有可能包含 agent 的元素
const elements = document.querySelectorAll('[class*="agent" i], [class*="card" i]');
console.log('Found elements:', elements.length);

// 显示元素内容
Array.from(elements).forEach((el, i) => {
  console.log(`Element ${i}:`, el.className, el.textContent?.substring(0, 50));
});
```

### 4. 检查当前页面

```javascript
console.log('Current path:', window.location.pathname);
console.log('Current hash:', window.location.hash);
```

### 5. 查找按钮和导航

```javascript
// 查找所有按钮
const buttons = document.querySelectorAll('button');
console.log('Buttons found:', buttons.length);

// 显示按钮文本
Array.from(buttons).slice(0, 20).forEach((btn, i) => {
  const text = btn.textContent?.trim();
  if (text) {
    console.log(`Button ${i}: "${text}"`);
  }
});
```

## 问题诊断

### 如果 `window.electronAPI` 存在

那么 IPC 通信应该是正常的。问题可能是：

1. **UI 过滤了数据** - 检查 React 组件的过滤逻辑
2. **在错误的页面** - 智能体可能只在特定页面显示
3. **需要特定交互** - 可能需要点击某个按钮才能显示

### 如果 `window.electronAPI` 不存在

那么 preload 脚本没有正确加载。这意味着：

1. **Preload 路径错误** - 检查 BrowserWindow 的 preload 配置
2. **Context isolation 问题** - 检查 contextBridge 是否正确工作

## 下一步

请在 Console 中运行：

```javascript
// 完整测试
console.log('=== AionUI Debug Info ===');
console.log('1. electronAPI exists:', !!window.electronAPI);
console.log('2. Current path:', window.location.pathname);
console.log('3. Current hash:', window.location.hash);

// 如果 electronAPI 存在，测试 IPC
if (window.electronAPI) {
  console.log('4. Testing IPC...');
  window.electronAPI.emit('subscribe-acp.get-available-agents', { id: 'test-' + Date.now() })
    .then(result => {
      console.log('5. IPC Result:', result);
      console.log('6. Success:', result?.success);
      console.log('7. Agent count:', result?.data?.length);
      if (result?.data) {
        result.data.forEach((agent, i) => {
          console.log(`   Agent ${i}:`, agent.backend, agent.name);
        });
      }
    })
    .catch(error => {
      console.error('5. IPC Error:', error);
    });
}

// 查找 UI 元素
console.log('8. Checking UI elements...');
const agents = document.querySelectorAll('[class*="agent" i]');
const cards = document.querySelectorAll('[class*="card" i]');
const buttons = document.querySelectorAll('button');
console.log('   Agents:', agents.length);
console.log('   Cards:', cards.length);
console.log('   Buttons:', buttons.length);

// 显示前几个按钮
console.log('9. Button texts:');
Array.from(buttons).slice(0, 10).forEach((btn, i) => {
  const text = btn.textContent?.trim();
  if (text && text.length > 0) {
    console.log(`   ${i}: "${text}"`);
  }
});
```

## 请告诉我

运行上面的完整测试后，请告诉我：

1. `electronAPI exists` 的结果（true 还是 false）
2. 当前的 path 和 hash
3. IPC 测试的结果（如果 electronAPI 存在）
4. 找到了多少个 agents、cards 和 buttons
5. 按钮的文本内容

这将帮助我确定问题的确切原因。

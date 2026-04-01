# 简单测试步骤

## 在 DevTools Console 中运行

### 1. 测试 IPC 通信

```javascript
// 测试 1：检查 bridge 是否存在
console.log('Bridge exists:', !!window.ipcBridge);

// 测试 2：获取智能体数据
const result = await window.ipcBridge.acpConversation.getAvailableAgents.invoke();
console.log('Raw result:', result);

// 测试 3：检查数据格式
console.log('Success:', result.success);
console.log('Data:', result.data);
console.log('Agent count:', result.data?.length);

// 测试 4：显示每个智能体
result.data?.forEach((agent, i) => {
  console.log(`Agent ${i}:`, agent.backend, agent.name, agent.isPreset);
});
```

### 2. 测试过滤函数

```javascript
// 模拟过滤逻辑
const mockAgents = [
  {
    backend: "claude",
    name: "Claude Code",
    isPreset: true,
    cliPath: "/usr/local/bin/claude",
    context: "AI coding assistant",
    avatar: "🤖"
  },
  {
    backend: "qwen",
    name: "Qwen Code",
    isPreset: true,
    cliPath: "npx @qwen-code/qwen-code",
    context: "Qwen AI assistant",
    avatar: "🔮"
  }
];

// 应用过滤（只过滤 gemini + cliPath）
const filtered = mockAgents.filter((agent) => !(agent.backend === 'gemini' && agent.cliPath));
console.log('Filtered agents:', filtered);
console.log('Should be 2:', filtered.length);
```

### 3. 检查 DOM

```javascript
// 查找可能显示智能体的元素
const elements = {
  agents: document.querySelectorAll('[class*="agent" i]'),
  cards: document.querySelectorAll('[class*="card" i]'),
  buttons: document.querySelectorAll('button'),
  selects: document.querySelectorAll('select'),
};

console.log('Found elements:', {
  agents: elements.agents.length,
  cards: elements.cards.length,
  buttons: elements.buttons.length,
  selects: elements.selects.length,
});

// 显示前几个按钮的文本
Array.from(elements.buttons).slice(0, 10).forEach((btn, i) => {
  console.log(`Button ${i}:`, btn.textContent?.trim());
});
```

### 4. 检查当前页面

```javascript
console.log('Current URL:', window.location.href);
console.log('Current path:', window.location.pathname);
console.log('Current hash:', window.location.hash);
```

### 5. 查找 React 组件

```javascript
// 尝试查找 React 根节点
const root = document.querySelector('#root');
console.log('Root element:', root);

// 查找所有可能的容器
const containers = document.querySelectorAll('[class*="container" i], [class*="wrapper" i], [class*="page" i]');
console.log('Containers found:', containers.length);

// 显示容器的类名
Array.from(containers).slice(0, 5).forEach((el, i) => {
  console.log(`Container ${i}:`, el.className);
});
```

## 如果上面的测试都正常

那么问题可能是：

### 可能性 1：在错误的页面

智能体可能只在特定页面显示。尝试：

1. 查找导航菜单
2. 点击不同的菜单项
3. 查看 URL 是否改变

### 可能性 2：需要额外的交互

可能需要：

1. 点击"新建对话"按钮
2. 打开设置页面
3. 点击某个特定的区域

### 可能性 3：UI 正在加载

可能需要等待一段时间，或者：

```javascript
// 等待 5 秒后重新检查
setTimeout(() => {
  console.log('Checking again...');
  const agents = document.querySelectorAll('[class*="agent" i]');
  console.log('Agents found:', agents.length);
}, 5000);
```

## 截图请求

如果可以的话，请提供：

1. AionUI 窗口的截图（显示当前页面）
2. DevTools Console 的截图（显示上面命令的输出）
3. DevTools Elements 标签的截图（显示 DOM 结构）

这将帮助我更好地理解问题所在。

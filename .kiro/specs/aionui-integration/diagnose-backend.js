// 在 AionUI 窗口的开发者工具 Console 中运行此脚本来诊断后端状态

(async function diagnoseBackend() {
  console.log('========================================');
  console.log('AionUI 后端诊断');
  console.log('========================================');
  console.log('');

  // 1. 检查 electronAPI 是否存在
  console.log('1. 检查 electronAPI:');
  if (window.electronAPI) {
    console.log('   ✅ electronAPI 存在');
    console.log('   可用方法:', Object.keys(window.electronAPI));
  } else {
    console.log('   ❌ electronAPI 不存在');
    return;
  }
  console.log('');

  // 2. 测试 IPC 通信
  console.log('2. 测试 IPC 通信:');
  try {
    const testResult = await window.electronAPI.emit('subscribe-acp.get-available-agents', {
      id: 'diagnose-test-' + Date.now()
    });
    console.log('   ✅ IPC 通信成功');
    console.log('   返回结果:', testResult);

    if (testResult && testResult.success) {
      console.log('   ✅ 后端响应成功');
      console.log('   Agent 数量:', testResult.data?.length || 0);

      if (testResult.data && testResult.data.length > 0) {
        console.log('   Agents:');
        testResult.data.forEach((agent, i) => {
          console.log(`     ${i + 1}. ${agent.name} (${agent.backend})`);
          if (agent.cliPath) {
            console.log(`        CLI: ${agent.cliPath}`);
          }
        });
      }
    } else {
      console.log('   ⚠️ 后端响应但没有成功标志');
    }
  } catch (error) {
    console.log('   ❌ IPC 通信失败:', error);
  }
  console.log('');

  // 3. 检查其他 IPC 方法
  console.log('3. 测试其他 IPC 方法:');

  const testMethods = [
    { name: 'extensions.get-skills', event: 'subscribe-extensions.get-skills' },
    { name: 'extensions.get-agents', event: 'subscribe-extensions.get-agents' },
    { name: 'google.auth.status', event: 'subscribe-google.auth.status' },
  ];

  for (const method of testMethods) {
    try {
      const result = await window.electronAPI.emit(method.event, { id: 'test-' + Date.now() });
      console.log(`   ✅ ${method.name}:`, result);
    } catch (error) {
      console.log(`   ❌ ${method.name}:`, error.message);
    }
  }
  console.log('');

  // 4. 检查 UI 状态
  console.log('4. 检查 UI 状态:');
  const agentPills = document.querySelectorAll('[data-agent-pill="true"]');
  console.log('   Agent pills 数量:', agentPills.length);

  if (agentPills.length > 0) {
    console.log('   Agents:');
    agentPills.forEach((pill, i) => {
      const backend = pill.getAttribute('data-agent-backend');
      const key = pill.getAttribute('data-agent-key');
      const selected = pill.getAttribute('data-agent-selected');
      console.log(`     ${i + 1}. backend=${backend}, key=${key}, selected=${selected}`);
    });
  } else {
    console.log('   ⚠️ 没有找到 agent pills');
  }
  console.log('');

  // 5. 检查 React 状态（如果可以访问）
  console.log('5. 检查页面元素:');
  const root = document.getElementById('root');
  if (root) {
    console.log('   ✅ React root 存在');
    console.log('   子元素数量:', root.children.length);
  } else {
    console.log('   ❌ React root 不存在');
  }
  console.log('');

  console.log('========================================');
  console.log('诊断完成');
  console.log('========================================');
})();

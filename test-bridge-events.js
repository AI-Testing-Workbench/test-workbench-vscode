// test-workbench_change - new file
// 在 DevTools Console 中运行此脚本来测试 Bridge 事件

console.log('=== AionUI Bridge 事件测试 ===\n');

// 测试 getAvailableAgents
console.log('1. 测试 acpConversation.getAvailableAgents:');
window.electronAPI.emit('acpConversation.getAvailableAgents', {})
    .then(result => {
        console.log('✅ 成功:', result);
        if (result.success && result.data) {
            console.log(`   找到 ${result.data.length} 个智能体:`);
            result.data.forEach(agent => {
                console.log(`   - ${agent.name} (${agent.backend})`);
            });
        }
    })
    .catch(error => {
        console.error('❌ 失败:', error);
    });

// 测试 getInstalledSkills
console.log('\n2. 测试 skillsMarket.getInstalledSkills:');
window.electronAPI.emit('skillsMarket.getInstalledSkills', {})
    .then(result => {
        console.log('✅ 成功:', result);
        if (result.success && result.data) {
            console.log(`   找到 ${result.data.length} 个技能:`);
            result.data.forEach(skill => {
                console.log(`   - ${skill.icon} ${skill.name}`);
            });
        }
    })
    .catch(error => {
        console.error('❌ 失败:', error);
    });

// 测试 config.get
console.log('\n3. 测试 config.get:');
window.electronAPI.emit('config.get', {})
    .then(result => {
        console.log('✅ 成功:', result);
    })
    .catch(error => {
        console.error('❌ 失败:', error);
    });

console.log('\n=== 测试完成 ===');
console.log('请等待 1-2 秒查看结果');
console.log('如果看到智能体和技能列表，说明 Bridge 工作正常！');

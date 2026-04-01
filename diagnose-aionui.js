// test-workbench_change - new file
// AionUI 诊断脚本 - 在 DevTools Console 中运行

console.log('=== AionUI 诊断开始 ===\n');

// 1. 检查 electronAPI
console.log('1. 检查 electronAPI:');
if (window.electronAPI) {
    console.log('✅ electronAPI 存在');
    console.log('   可用方法:', Object.keys(window.electronAPI));
} else {
    console.error('❌ electronAPI 不存在');
}
console.log('');

// 2. 检查 localStorage
console.log('2. 检查 localStorage:');
try {
    const keys = Object.keys(localStorage);
    console.log(`✅ localStorage 可访问，共 ${keys.length} 个键`);
    if (keys.length > 0) {
        console.log('   前 10 个键:', keys.slice(0, 10));
    }
} catch (error) {
    console.error('❌ localStorage 访问失败:', error);
}
console.log('');

// 3. 测试 IPC 通信
console.log('3. 测试 IPC 通信:');
if (window.electronAPI && window.electronAPI.emit) {
    window.electronAPI.emit('test', { message: 'diagnostic test' })
        .then(result => {
            console.log('✅ IPC 通信成功');
            console.log('   返回结果:', result);
        })
        .catch(error => {
            console.error('❌ IPC 通信失败:', error);
        });
} else {
    console.error('❌ electronAPI.emit 不存在');
}
console.log('');

// 4. 检查 React 应用状态
console.log('4. 检查 React 应用:');
const rootElement = document.getElementById('root');
if (rootElement) {
    console.log('✅ React root 元素存在');
    console.log('   子元素数量:', rootElement.children.length);
    if (rootElement.children.length === 0) {
        console.warn('⚠️  React 应用可能未正确挂载');
    }
} else {
    console.error('❌ React root 元素不存在');
}
console.log('');

// 5. 检查网络请求
console.log('5. 检查网络请求:');
console.log('   请切换到 Network 标签查看是否有失败的请求');
console.log('   特别关注 API 请求和数据加载请求');
console.log('');

// 6. 检查全局状态
console.log('6. 检查全局状态:');
console.log('   window 对象上的自定义属性:');
const customProps = Object.keys(window).filter(key =>
    !key.startsWith('webkit') &&
    !key.startsWith('chrome') &&
    key !== 'electronAPI' &&
    typeof window[key] !== 'function'
).slice(0, 20);
console.log('   ', customProps);
console.log('');

console.log('=== AionUI 诊断完成 ===');
console.log('\n请将以上输出截图或复制给我！');

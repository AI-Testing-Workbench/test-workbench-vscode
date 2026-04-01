// test-workbench_change - new file
// 在 DevTools Console 中运行此脚本来测试存储访问

console.log('=== 存储访问测试 ===\n');

// 1. 测试 localStorage
console.log('1. localStorage 测试:');
try {
    localStorage.setItem('test', 'value');
    const value = localStorage.getItem('test');
    console.log('✅ localStorage 可读写:', value);
    localStorage.removeItem('test');
} catch (error) {
    console.error('❌ localStorage 错误:', error);
}

// 2. 测试 IndexedDB
console.log('\n2. IndexedDB 测试:');
if (window.indexedDB) {
    console.log('✅ IndexedDB API 存在');

    // 尝试打开数据库
    const request = indexedDB.open('test-db', 1);

    request.onsuccess = () => {
        console.log('✅ IndexedDB 可访问');
        request.result.close();
        indexedDB.deleteDatabase('test-db');
    };

    request.onerror = (event) => {
        console.error('❌ IndexedDB 错误:', event.target.error);
    };
} else {
    console.error('❌ IndexedDB API 不存在');
}

// 3. 检查现有的 IndexedDB 数据库
console.log('\n3. 现有数据库:');
if (window.indexedDB.databases) {
    indexedDB.databases().then(databases => {
        console.log('数据库列表:', databases);
        if (databases.length === 0) {
            console.warn('⚠️  没有找到任何数据库');
        }
    });
} else {
    console.log('⚠️  浏览器不支持 indexedDB.databases()');
}

// 4. 检查 buildStorage
console.log('\n4. 检查 buildStorage:');
setTimeout(() => {
    // 等待一下，看看是否有 buildStorage 相关的全局变量
    const buildStorageKeys = Object.keys(window).filter(key =>
        key.includes('build') || key.includes('storage') || key.includes('Storage')
    );
    console.log('相关的全局变量:', buildStorageKeys);
}, 1000);

console.log('\n=== 测试完成 ===');
console.log('请等待 1-2 秒查看完整结果');

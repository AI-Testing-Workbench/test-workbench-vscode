# AionUI 数据加载修复报告

## 问题总结

AionUI 窗口成功启动并显示 UI，但无法加载数据（多智能体图标、技能列表等）。

## 根本原因

AionUI 使用 `@office-ai/platform` 的 bridge 系统进行 IPC 通信。该系统需要：

1. **IPC 处理器注册**：通过 `ipcMain.handle('office-ai-bridge-adapter', ...)` 注册
2. **Bridge Providers**：提供实际的数据和功能（存储、扩展、服务等）

之前的实现尝试导入 AionUI 的主模块来初始化 bridge 系统，但这会导致：
- 尝试启动完整的 Electron 应用（与 VS Code 冲突）
- 路径错误（`process/index.js` 不存在，实际是 `main/index.js`）

## 修复方案

### 阶段 1：基础 IPC 处理器（已完成）

在 `src/vs/aionui/electron-main/aionuiWindowManager.js` 中手动注册 IPC 处理器：

```javascript
// 手动注册 IPC bridge 处理器
const { ipcMain } = electron;
const ADAPTER_BRIDGE_EVENT_KEY = 'office-ai-bridge-adapter';

// 注册 IPC 处理器
ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, (_event, info) => {
    try {
        const { name, data } = JSON.parse(info);
        this.logService.trace('AionUIWindowManager - bridge event received:', { name });

        // 目前只是确认事件，返回成功
        return Promise.resolve({ success: true });
    } catch (error) {
        this.logService.error('AionUIWindowManager - bridge event handler error:', error);
        return Promise.reject(error);
    }
});
```

### 测试结果

✅ **成功**：
- IPC 处理器成功注册
- 窗口成功添加到 bridge adapter 列表
- Bridge 事件被正确接收
- 没有 "No handler registered" 错误

❌ **限制**：
- UI 仍然没有数据，因为处理器只返回 `{ success: true }`
- 没有实际的数据提供者（storage, extensions, services）

## 下一步：完整数据支持

### 选项 A：最小化数据提供者（推荐）

创建简化的数据提供者，只提供 UI 需要的基本数据：

```javascript
// 创建简化的 bridge emitter
const bridgeEmitter = {
    emit: (name, data) => {
        // 根据事件名称返回相应的数据
        switch(name) {
            case 'subscribe-agent.config.storage.get':
                // 返回配置数据
                return Promise.resolve({ /* config data */ });
            case 'subscribe-agent.env.storage.get':
                // 返回环境数据
                return Promise.resolve({ /* env data */ });
            // ... 其他事件
            default:
                return Promise.resolve({ success: true });
        }
    }
};

ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, (_event, info) => {
    const { name, data } = JSON.parse(info);
    return bridgeEmitter.emit(name, data);
});
```

### 选项 B：完整 AionUI 集成

将 AionUI 的完整 bridge 系统集成到 VS Code：

1. 复制 AionUI 的 bridge providers 到 VS Code
2. 初始化存储系统（SQLite）
3. 初始化扩展注册表
4. 初始化所有服务

**优点**：完整功能
**缺点**：复杂度高，维护成本大

## 当前状态

- ✅ IPC 桥接基础设施已建立
- ✅ 窗口成功启动并显示 UI
- ✅ Bridge 事件正确路由
- ⏳ 等待实现数据提供者

## 技术细节

### AionUI Bridge 架构

```
Renderer Process (AionUI UI)
    ↓ IPC invoke('office-ai-bridge-adapter', {name, data})
Main Process (VS Code)
    ↓ ipcMain.handle('office-ai-bridge-adapter', ...)
Bridge Emitter
    ↓ emit(name, data)
Bridge Providers (Storage, Extensions, Services)
    ↓ 返回数据
```

### 关键文件

- `src/vs/aionui/electron-main/aionuiWindowManager.js` - 窗口管理器（已修复）
- `extensions/aionui-main/src/common/adapter/main.ts` - Bridge adapter 源码
- `extensions/aionui-main/src/process/utils/initBridge.ts` - Bridge 初始化源码
- `extensions/aionui-main/src/process/bridge/` - Bridge providers 源码

### 日志输出

成功的日志输出示例：

```
[main] AionUIWindowManager - IPC bridge handler registered
[main] AionUIWindowManager - window added to bridge adapter list
[main] AionUIWindowManager - bridge event received: { name: 'subscribe-agent.config.storage.get' }
```

## 建议

1. **短期**：实现选项 A（最小化数据提供者），快速验证 UI 功能
2. **长期**：评估是否需要选项 B（完整集成），取决于需要的功能范围
3. **测试**：创建测试用例验证各种 bridge 事件的处理

## 相关文档

- `AIONUI_IPC_FIX_REPORT.md` - 之前的 IPC 修复尝试
- `AIONUI_INTEGRATION_COMPLETE.md` - 初始集成文档
- `测试说明.md` - 测试指南

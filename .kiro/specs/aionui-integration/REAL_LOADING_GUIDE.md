# AionUI 真实加载实现指南

## 当前状态总结

### ✅ 已实现（2024-03-30 更新）
- Gemini 智能体立即显示
- 20 个预设助手立即显示
- 用户界面完全可用
- 无加载延迟
- **新增**: 复制了 1104 个运行时依赖包到输出目录
- **新增**: 设置 NODE_PATH 以支持依赖查找
- **新增**: 完整后端初始化代码已就绪

### ⚠️ 待验证
- 完整后端是否能在 Electron 环境中成功初始化
- CLI 工具检测功能是否正常工作
- 用户自定义智能体配置加载

## 问题根源

### ES 模块兼容性冲突

**VS Code 侧**:
```json
// package.json
{
  "type": "module"  // 声明为 ES 模块
}
```

**AionUI 侧**:
```javascript
// out/aionui/dist/main/index.js (构建输出)
exports.initializeProcess = function() { ... }  // CommonJS 格式
```

**冲突结果**:
```
ReferenceError: exports is not defined in ES module scope
```

## 解决方案

### 方案 4：复制 node_modules + 设置 NODE_PATH（已实施）

#### 实施内容

**步骤 1**: 修改 `build/gulpfile.aionui.js`，添加 `copyNodeModules()` 函数

```javascript
async function copyNodeModules() {
  // 选择性复制 node_modules，排除开发依赖
  // 复制了 1104 个运行时包，跳过了 20 个开发包
  // 排除: electron, vite, typescript, @types, eslint 等
}
```

**步骤 2**: 修改 `src/vs/aionui/electron-main/aionuiWindowManager.js`

```javascript
// 设置 NODE_PATH 环境变量
const aionuiNodeModules = join(this.environmentService.appRoot, 'out', 'aionui', 'node_modules');
if (existsSync(aionuiNodeModules)) {
  process.env.NODE_PATH = aionuiNodeModules;
  const Module = require('module');
  if (Module._initPaths) {
    Module._initPaths();
  }
}
```

**步骤 3**: 保持 Vite 配置输出 CommonJS 格式

```typescript
// electron.vite.config.ts
build: {
  ssr: {
    noExternal: true,  // 尝试捆绑所有依赖
    external: ['electron', 'original-fs'],
  },
  rollupOptions: {
    output: {
      format: 'cjs',
      entryFileNames: '[name].cjs',
    }
  }
}
```

#### 优点
- ✅ 解决了依赖查找问题
- ✅ 支持原生模块（better-sqlite3 等）
- ✅ 不需要修改 AionUI 源代码
- ✅ 与 VS Code 的 ES 模块环境兼容

#### 缺点
- ❌ 增加了构建输出大小（~500MB node_modules）
- ❌ 构建时间较长（复制 1104 个包需要 30 秒）
- ❌ 仍需在 Electron 环境中验证是否成功

#### 测试方法

参见 [FULL_BACKEND_TEST.md](./FULL_BACKEND_TEST.md) 获取详细测试步骤。

#### 步骤 1：修改 Vite 配置

文件: `extensions/aionui-main/electron.vite.config.ts`

在 `main` 配置中添加：

```typescript
main: {
  build: {
    rollupOptions: {
      output: {
        format: 'es',  // 输出 ES 模块而不是 CommonJS
        entryFileNames: '[name].mjs',  // 使用 .mjs 扩展名
      }
    }
  }
}
```

#### 步骤 2：修改 VS Code 集成代码

文件: `src/vs/aionui/electron-main/aionuiWindowManager.js`

```javascript
// 修改前
const aionuiMainPath = join(aionuiPath, 'out', 'main', 'index.js');
const { initializeProcess } = await import(aionuiMainPath);

// 修改后
const aionuiMainPath = join(aionuiPath, 'out', 'main', 'index.mjs');
const { initializeProcess } = await import(aionuiMainPath);
```

#### 步骤 3：重新构建

```bash
cd extensions/aionui-main
bun run package

cd ../..
yarn gulp vscode-darwin-arm64-min
```

### 方案 2：使用 .cjs 扩展名（简单但不优雅）

#### 步骤 1：修改 Vite 配置

```typescript
main: {
  build: {
    rollupOptions: {
      output: {
        entryFileNames: '[name].cjs',  // 使用 .cjs 扩展名
      }
    }
  }
}
```

#### 步骤 2：修改 VS Code 集成代码

```javascript
const aionuiMainPath = join(aionuiPath, 'out', 'main', 'index.cjs');
// 使用 createRequire 加载 CommonJS 模块
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const { initializeProcess } = require(aionuiMainPath);
```

### 方案 3：保持当前方案（默认数据 + 回退机制）

**优点**:
- ✅ 用户体验最好（无加载延迟）
- ✅ 代码简单，易于维护
- ✅ 向后兼容

**缺点**:
- ❌ 无法检测系统中的 CLI 工具
- ❌ 无法加载用户自定义配置
- ❌ 功能受限（只有预设助手）

**适用场景**:
- 快速原型验证
- 基础功能演示
- 不需要高级功能的用户

## 当前实现的工作原理

### 1. 智能体加载

**文件**: `extensions/aionui-main/src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`

```typescript
// 提供默认 Gemini agent
const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([
  {
    backend: 'gemini',
    name: 'Gemini',
    supportedTransports: []
  }
]);

// SWR 在后台尝试获取真实数据
const { data: availableAgentsData } = useSWR('acp.agents.available', async () => {
  const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
  if (result.success) {
    return result.data;
  }
  return [];
});

// 如果后台获取成功，更新状态
useEffect(() => {
  if (availableAgentsData) {
    setAvailableAgents(availableAgentsData);
  }
}, [availableAgentsData]);
```

### 2. 助手加载

**文件**: `extensions/aionui-main/src/renderer/pages/guid/hooks/useCustomAgentsLoader.ts`

```typescript
import { ASSISTANT_PRESETS } from '@/common/config/presets/assistantPresets';

// 提供默认预设助手
const [customAgents, setCustomAgents] = useState<AcpBackendConfig[]>(() => {
  return ASSISTANT_PRESETS.map((preset) => ({
    id: `builtin-${preset.id}`,
    name: preset.nameI18n['en-US'] || preset.id,
    nameI18n: preset.nameI18n,
    avatar: preset.avatar,
    isPreset: true,
    enabled: true,
    // ... 其他配置
  }));
});

// SWR 在后台尝试获取真实数据
useEffect(() => {
  Promise.all([
    ConfigStorage.get('acp.customAgents'),
    ipcBridge.extensions.getAssistants.invoke()
  ]).then(([agents, extAssistants]) => {
    // 合并用户自定义和扩展贡献的助手
    setCustomAgents([...agents, ...extAssistants]);
  });
}, []);
```

### 3. 回退机制

**文件**: `src/vs/aionui/electron-main/aionuiWindowManager.js`

```javascript
async launchAionUIInProcess(electron) {
  try {
    // 尝试完整初始化
    const { initializeProcess } = await import(aionuiMainPath);
    await initializeProcess(electron);
    this.logService.info('✅ AionUI backend initialized successfully');
  } catch (error) {
    // 失败时使用回退机制
    this.logService.warn('⚠️ Full backend failed, using fallback');
    await this.setupFallbackIpcHandler(electron);
  }
}
```

## 测试验证

### 验证默认数据加载

1. 启动打包的 VS Code
2. 打开 DevTools (Cmd+Option+I)
3. 检查 Console，应该看到：
   - ✅ 无 JavaScript 错误
   - ✅ Gemini 智能体显示
   - ✅ 20 个助手显示

### 验证 IPC 通信

在 DevTools Console 中运行：

```javascript
// 测试智能体获取
window.electronAPI.emit('subscribe-acp.get-available-agents', {id:'test'})
  .then(r => console.log('Agents:', r))
  .catch(e => console.error('Error:', e));

// 测试助手获取
window.electronAPI.emit('subscribe-extensions.get-assistants', {id:'test'})
  .then(r => console.log('Assistants:', r))
  .catch(e => console.error('Error:', e));
```

## 推荐实施路径

### 短期（当前）
✅ 使用方案 3（默认数据 + 回退机制）
- 用户体验最好
- 快速验证集成
- 基础功能可用

### 中期（1-2 周）
🔄 实施方案 1（ES 模块输出）
- 解决兼容性问题
- 启用完整后端功能
- 支持 CLI 工具检测

### 长期（1-2 月）
🚀 优化和增强
- 添加错误处理和重试
- 优化加载性能
- 支持热重载和更新

## 相关文件

### 前端
- `extensions/aionui-main/src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`
- `extensions/aionui-main/src/renderer/pages/guid/hooks/useCustomAgentsLoader.ts`
- `extensions/aionui-main/src/common/config/presets/assistantPresets.ts`

### 后端
- `src/vs/aionui/electron-main/aionuiWindowManager.js`
- `extensions/aionui-main/src/index.ts`
- `extensions/aionui-main/electron.vite.config.ts`

### 构建
- `build/gulpfile.aionui.js`
- `extensions/aionui-main/package.json`

## 总结

当前实现已经提供了良好的用户体验，智能体和助手都能正常显示。如果需要完整的后端功能（CLI 检测、用户配置等），需要解决 ES 模块兼容性问题。推荐先使用当前方案验证集成，然后逐步实施完整的后端支持。

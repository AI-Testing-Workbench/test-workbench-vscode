# 检查 AionUI 后端状态

由于 VS Code DevTools Console 可能过滤了主进程日志，我们需要用其他方式检查后端状态。

## 方法 1：在 AionUI 窗口的 DevTools 中测试

打开 AionUI 窗口后，在它的 DevTools Console 中运行以下代码来测试后端功能：

```javascript
// 测试 ACP 检测（CLI 工具检测）
window.electronAPI.emit('subscribe-acp.get-available-agents', { id: 'test-' + Date.now() })
  .then(result => {
    console.log('=== ACP Detection Result ===');
    console.log('Success:', result.success);
    console.log('Agent count:', result.data?.length);
    console.log('Agents:', JSON.stringify(result.data, null, 2));

    // 检查是否有真实的 CLI agents（不只是 fallback 的 Gemini）
    const hasRealAgents = result.data?.some(agent =>
      agent.cliPath || agent.supportedTransports?.length > 0
    );

    if (hasRealAgents) {
      console.log('✅ 后端成功启动 - 检测到真实的 CLI agents');
    } else {
      console.log('⚠️ 后端使用 fallback 模式 - 只有默认的 Gemini agent');
    }
  });

// 测试扩展加载
window.electronAPI.emit('subscribe-extensions.get-loaded-extensions', { id: 'test-' + Date.now() })
  .then(result => {
    console.log('=== Extensions Result ===');
    console.log('Extensions:', result);
    if (result && result.length > 0) {
      console.log('✅ 扩展系统正常工作');
    } else {
      console.log('⚠️ 没有加载扩展（可能是 fallback 模式）');
    }
  });
```

## 方法 2：检查文件是否存在

在终端中运行以下命令检查必要的文件是否都存在：

```bash
# 检查 AionUI 主进程文件
ls -la VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/dist/main/

# 检查 node_modules
ls -la VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/node_modules/ | head -20

# 检查 package.json
cat VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/package.json
```

## 方法 3：查看 VS Code 主进程日志文件

```bash
# 找到最新的日志目录
ls -lt ~/Library/Application\ Support/Code\ -\ OSS/logs/ | head -5

# 查看主进程日志（替换日期为最新的）
grep -i "aionui" ~/Library/Application\ Support/Code\ -\ OSS/logs/*/main.log
```

## 预期结果

### 如果后端成功启动：
- ACP 检测应该返回多个 agents（不只是 Gemini）
- 某些 agents 应该有 `cliPath` 属性
- 扩展列表不应该为空

### 如果使用 fallback 模式：
- 只返回一个 Gemini agent
- 没有 `cliPath` 属性
- `supportedTransports` 为空数组
- 扩展列表为空

## 下一步

根据测试结果：
1. 如果后端成功启动 → 集成完成！
2. 如果使用 fallback 模式 → 需要查看为什么 `initializeProcess` 没有被调用或失败了

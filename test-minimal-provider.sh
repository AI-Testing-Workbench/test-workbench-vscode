#!/bin/bash
# test-workbench_change - new file
# Test minimal data provider

echo "🧪 测试最小化数据提供者"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

LOG_FILE="minimal-provider-test.log"
> "$LOG_FILE"

echo "启动 AionUI..."
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui --verbose 2>&1 | tee "$LOG_FILE" &
PID=$!

echo "进程 PID: $PID"
echo "等待 8 秒收集日志..."
sleep 8

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 测试结果分析"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查 IPC 处理器注册
if grep -q "IPC bridge handler registered" "$LOG_FILE"; then
    echo "✅ IPC 处理器已注册"
else
    echo "❌ IPC 处理器未注册"
fi

# 检查窗口创建
if grep -q "window added to bridge adapter list" "$LOG_FILE"; then
    echo "✅ 窗口已添加到 bridge adapter"
else
    echo "❌ 窗口未添加到 bridge adapter"
fi

# 检查数据提供者事件
echo ""
echo "📡 接收到的 bridge 事件："
grep "bridge event received" "$LOG_FILE" | sed 's/.*bridge event received: /  - /' | sort -u

# 检查数据提供者响应
echo ""
echo "📤 数据提供者响应："
if grep -q "MinimalDataProvider" "$LOG_FILE"; then
    grep "MinimalDataProvider" "$LOG_FILE" | tail -10 | sed 's/^/  /'
else
    echo "  ⚠️  未找到 MinimalDataProvider 日志"
fi

# 检查错误
echo ""
echo "❌ 错误信息："
ERROR_COUNT=$(grep -c "No handler registered" "$LOG_FILE" 2>/dev/null || echo "0")
if [ "$ERROR_COUNT" -gt 0 ]; then
    echo "  ⚠️  发现 $ERROR_COUNT 个 'No handler registered' 错误"
else
    echo "  ✅ 没有 'No handler registered' 错误"
fi

# 检查进程状态
echo ""
if ps -p $PID > /dev/null; then
    echo "✅ 进程正在运行 (PID: $PID)"
    echo ""
    echo "请手动检查 AionUI 窗口："
    echo "  1. 窗口是否打开？"
    echo "  2. DevTools 是否显示？"
    echo "  3. 是否显示任何技能或智能体？"
    echo "  4. Console 中是否有错误？"
    echo ""
    echo "完整日志: $LOG_FILE"
    echo "停止进程: kill $PID"
else
    echo "❌ 进程已退出"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

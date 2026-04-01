#!/bin/bash
# test-workbench_change - new file
# AionUI 测试脚本 - 带完整日志输出

echo "========================================="
echo "  AionUI 调试测试"
echo "========================================="
echo ""

# 关闭所有现有的 VS Code 实例
echo "🔄 关闭现有的 VS Code 实例..."
pkill -f "Code - OSS" 2>/dev/null
sleep 2

# 清理日志文件
LOG_FILE="/tmp/aionui-debug.log"
rm -f "$LOG_FILE"

echo "📝 日志文件: $LOG_FILE"
echo ""

# 启动 AionUI 并捕获所有输出
echo "🚀 启动 AionUI（带 DevTools）..."
echo "   窗口将自动打开开发者工具"
echo ""

"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui --verbose > "$LOG_FILE" 2>&1 &
APP_PID=$!

echo "✅ 应用已启动 (PID: $APP_PID)"
echo ""
echo "等待 5 秒让应用完全启动..."
sleep 5

echo ""
echo "========================================="
echo "  查看日志"
echo "========================================="
echo ""

# 显示 AionUI 相关的日志
echo "📋 AionUI 初始化日志:"
echo "---"
grep -i "aionui" "$LOG_FILE" | head -n 30
echo ""

echo "📋 控制台消息:"
echo "---"
grep -i "console" "$LOG_FILE" | head -n 20
echo ""

echo "📋 错误信息:"
echo "---"
grep -iE "error|failed|err_" "$LOG_FILE" | head -n 20
echo ""

echo "========================================="
echo "  实时日志监控"
echo "========================================="
echo ""
echo "按 Ctrl+C 停止监控"
echo ""

# 实时显示日志
tail -f "$LOG_FILE" | grep --line-buffered -iE "aionui|console|error|warn"

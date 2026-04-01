#!/bin/bash
# test-workbench_change - new file
# 启动 AionUI 并过滤掉无害的警告

echo "🚀 启动 AionUI（过滤无害警告）..."
echo ""

# 关闭现有实例
pkill -f "Code - OSS" 2>/dev/null
sleep 1

# 启动并过滤输出
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui 2>&1 | \
  grep -v "Sentry SDK failed" | \
  grep -v "Autofill.enable" | \
  grep -v "Autofill.setAddresses" | \
  grep -v "ignore-certificate-errors" &

APP_PID=$!

echo "✅ AionUI 已启动 (PID: $APP_PID)"
echo ""
echo "💡 提示："
echo "   - DevTools 会自动打开"
echo "   - 已过滤 Sentry 和 Autofill 警告"
echo "   - 只显示真正的错误信息"
echo ""
echo "按 Ctrl+C 停止监控日志"
echo ""

# 等待进程
wait $APP_PID

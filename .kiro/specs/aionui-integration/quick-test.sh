#!/bin/bash

# 快速测试 AionUI 后端初始化

APP_PATH="$HOME/VSCode-darwin-arm64/Code - OSS.app"
LOG_FILE="/tmp/vscode-aionui-test-$(date +%s).log"

echo "========================================="
echo "快速测试 AionUI 后端初始化"
echo "========================================="
echo ""
echo "日志文件: $LOG_FILE"
echo ""

# 启动应用并捕获日志
echo "启动 VS Code..."
"$APP_PATH/Contents/MacOS/Code - OSS" --enable-logging --log-level=0 > "$LOG_FILE" 2>&1 &
APP_PID=$!

echo "应用 PID: $APP_PID"
echo "等待 10 秒让应用启动..."
sleep 10

# 检查日志
echo ""
echo "========================================="
echo "检查后端初始化日志"
echo "========================================="
echo ""

if grep -q "✅ AionUI backend initialized successfully" "$LOG_FILE"; then
    echo "✅ 后端初始化成功！"
    SUCCESS=true
else
    echo "❌ 后端初始化失败"
    SUCCESS=false
fi

echo ""
echo "关键日志:"
echo ""
grep -E "(AionUI|backend|initialized|Cannot find|Error:)" "$LOG_FILE" | head -20

# 关闭应用
echo ""
echo "关闭应用..."
kill $APP_PID 2>/dev/null
sleep 2
kill -9 $APP_PID 2>/dev/null

echo ""
echo "========================================="
if [ "$SUCCESS" = true ]; then
    echo "✅ 测试通过！"
else
    echo "❌ 测试失败"
    echo ""
    echo "完整日志: $LOG_FILE"
fi
echo "========================================="

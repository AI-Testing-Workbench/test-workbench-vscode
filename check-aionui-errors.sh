#!/bin/bash
# test-workbench_change - new file
# 快速检查 AionUI 错误

echo "🔍 检查 AionUI 运行状态和错误..."
echo ""

# 检查进程是否运行
if pgrep -f "Code - OSS" > /dev/null; then
    echo "✅ VS Code 正在运行"

    # 检查是否有 AionUI 窗口
    WINDOW_COUNT=$(osascript -e 'tell application "System Events" to count (every window of process "Code - OSS" whose name contains "AionUI")' 2>/dev/null || echo "0")

    if [ "$WINDOW_COUNT" -gt 0 ]; then
        echo "✅ 找到 $WINDOW_COUNT 个 AionUI 窗口"
    else
        echo "⚠️  未找到 AionUI 窗口"
    fi
else
    echo "❌ VS Code 未运行"
fi

echo ""
echo "📋 最近的日志（如果有）:"
echo "---"

# 检查 VS Code 日志目录
LOG_DIR="$HOME/Library/Application Support/Code - OSS/logs"
if [ -d "$LOG_DIR" ]; then
    LATEST_LOG=$(find "$LOG_DIR" -name "main.log" -type f -print0 | xargs -0 ls -t | head -n 1)
    if [ -n "$LATEST_LOG" ]; then
        echo "日志文件: $LATEST_LOG"
        echo ""
        echo "AionUI 相关日志:"
        grep -i "aionui" "$LATEST_LOG" | tail -n 20
        echo ""
        echo "错误信息:"
        grep -iE "error.*aionui|aionui.*error" "$LATEST_LOG" | tail -n 10
    fi
else
    echo "未找到日志目录"
fi

echo ""
echo "💡 提示:"
echo "   1. 启动应用: ../VSCode-darwin-arm64/Code\\ -\\ OSS.app/Contents/MacOS/Code\\ -\\ OSS --aionui"
echo "   2. 开发者工具会自动打开，查看 Console 标签"
echo "   3. 查看 Network 标签检查资源加载"
echo "   4. 查看 Sources 标签检查文件是否存在"

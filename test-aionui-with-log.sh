#!/bin/bash
# test-workbench_change - new file
# Launch AionUI with detailed logging

LOG_FILE="aionui-launch.log"

echo "🚀 启动 AionUI 并记录日志到 $LOG_FILE..."
echo ""

# Clear previous log
> "$LOG_FILE"

# Launch and capture output
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui --verbose --log trace 2>&1 | tee "$LOG_FILE" &

PID=$!
echo "进程 ID: $PID"
echo ""
echo "日志文件: $LOG_FILE"
echo "按 Ctrl+C 停止监控（应用会继续运行）"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait a bit and show initial output
sleep 3
echo ""
echo "初始日志输出："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
head -50 "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "完整日志请查看: $LOG_FILE"
echo "继续监控日志: tail -f $LOG_FILE"

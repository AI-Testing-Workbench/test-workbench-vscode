#!/bin/bash
# test-workbench_change - new file
# Quick test to capture startup errors

echo "启动 AionUI 并捕获前 5 秒的输出..."
echo ""

# Run in background and capture output
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui --verbose 2>&1 &
PID=$!

echo "进程 PID: $PID"
echo "等待 5 秒..."
sleep 5

echo ""
echo "检查进程状态..."
if ps -p $PID > /dev/null; then
    echo "✓ 进程正在运行"
    echo ""
    echo "请手动检查："
    echo "  1. AionUI 窗口是否打开？"
    echo "  2. DevTools 是否显示？"
    echo "  3. 是否有数据显示（多智能体图标、技能列表）？"
    echo ""
    echo "如需停止，运行: kill $PID"
else
    echo "✗ 进程已退出（可能有错误）"
    echo "退出码: $?"
fi

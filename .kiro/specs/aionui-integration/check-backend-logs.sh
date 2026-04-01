#!/bin/bash

# 检查 AionUI 后端初始化日志

echo "========================================="
echo "检查 AionUI 后端日志"
echo "========================================="
echo ""

# 查找最新的日志文件
LOG_DIR="$HOME/Library/Application Support/Code - OSS/logs"
LATEST_LOG=$(ls -t "$LOG_DIR"/*/main.log 2>/dev/null | head -1)

if [ -z "$LATEST_LOG" ]; then
    echo "❌ 未找到日志文件"
    echo "日志目录: $LOG_DIR"
    exit 1
fi

echo "日志文件: $LATEST_LOG"
echo ""

echo "========================================="
echo "后端初始化相关日志"
echo "========================================="
echo ""

# 检查后端初始化
if grep -q "Initializing AionUI backend system" "$LATEST_LOG"; then
    echo "✅ 找到后端初始化日志"
    echo ""
    grep "AionUI backend" "$LATEST_LOG" | tail -20
else
    echo "❌ 未找到后端初始化日志"
fi

echo ""
echo "========================================="
echo "IPC 处理器注册日志"
echo "========================================="
echo ""

grep -E "(IPC handler|office-ai-bridge-adapter)" "$LATEST_LOG" | tail -10

echo ""
echo "========================================="
echo "错误日志"
echo "========================================="
echo ""

grep -E "(Error|Failed|Cannot find)" "$LATEST_LOG" | grep -i aionui | tail -10

echo ""
echo "========================================="
echo "完整的 AionUI 相关日志"
echo "========================================="
echo ""

grep -i aionui "$LATEST_LOG" | tail -30

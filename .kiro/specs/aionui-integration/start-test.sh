#!/bin/bash
# 启动测试脚本

echo "======================================"
echo "  启动 AionUI 测试"
echo "======================================"
echo ""

# 1. 复制最新的集成文件
echo "1️⃣  更新集成文件..."
cp src/vs/aionui/electron-main/aionuiWindowManager.js out-vscode-min/vs/aionui/electron-main/aionuiWindowManager.js
echo "✅ 文件已更新"
echo ""

# 2. 启动 VS Code
echo "2️⃣  启动 VS Code..."
echo ""
echo "请按照以下步骤操作："
echo ""
echo "  1. 等待 VS Code 窗口打开"
echo "  2. 按 Cmd+Shift+P 打开命令面板"
echo "  3. 输入 'aionui' 并选择 'AionUI: Open Window'"
echo "  4. 查看 DevTools Console 中的日志"
echo ""
echo "启动中..."
echo ""

./scripts/code.sh

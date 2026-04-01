#!/bin/bash
# 测试 VS Code 中的 AionUI

echo "🚀 启动 VS Code 并测试 AionUI..."
echo ""

VSCODE_PATH="../VSCode-darwin-arm64/Code - OSS.app"

if [ ! -d "$VSCODE_PATH" ]; then
    echo "❌ VS Code 未找到：$VSCODE_PATH"
    exit 1
fi

echo "✅ VS Code 路径：$VSCODE_PATH"
echo ""
echo "启动 VS Code..."
echo "请在 VS Code 中："
echo "  1. 按 Cmd+Shift+P 打开命令面板"
echo "  2. 搜索 'AionUI' 或 'Open AionUI Window'"
echo "  3. 选择命令打开 AionUI"
echo ""
echo "检查开发者工具（DevTools）中的错误信息"
echo ""

# 启动 VS Code
open "$VSCODE_PATH"

echo "VS Code 已启动"
echo ""
echo "日志位置："
echo "  - VS Code 日志：Help > Toggle Developer Tools > Console"
echo "  - AionUI 日志：AionUI 窗口 > DevTools > Console"

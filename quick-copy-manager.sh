#!/bin/bash
# 快速复制 aionuiWindowManager.js - 只复制修改的文件

set -e

echo "========================================="
echo "快速更新 AionUI Window Manager"
echo "========================================="
echo ""

VSCODE_OUT="../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out"
SOURCE_FILE="src/vs/aionui/electron-main/aionuiWindowManager.js"
TARGET_FILE="$VSCODE_OUT/vs/aionui/electron-main/aionuiWindowManager.js"

if [ ! -d "$VSCODE_OUT" ]; then
    echo "❌ VS Code 构建目录不存在"
    echo "运行: npm run gulp vscode-darwin-arm64"
    exit 1
fi

if [ ! -f "$SOURCE_FILE" ]; then
    echo "❌ 源文件不存在: $SOURCE_FILE"
    exit 1
fi

# 创建目标目录（如果不存在）
mkdir -p "$(dirname "$TARGET_FILE")"

# 复制文件
echo "📋 复制 $SOURCE_FILE"
echo "   到 $TARGET_FILE"
cp "$SOURCE_FILE" "$TARGET_FILE"

echo ""
echo "✅ 更新完成！"
echo ""
echo "现在可以测试："
echo "  ./test-vscode-aionui.sh"
echo ""

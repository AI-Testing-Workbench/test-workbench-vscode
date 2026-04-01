#!/bin/bash
# 快速重建 - 只重建必要的部分

set -e

echo "========================================="
echo "快速重建 AionUI 和 VS Code"
echo "========================================="
echo ""

# 1. 重建 AionUI
echo "1️⃣ 重建 AionUI..."
cd extensions/aionui-main
npm run package
cd ../..
echo "✅ AionUI 重建完成"
echo ""

# 2. 只复制 AionUI 到 VS Code 构建目录（不重新构建整个 VS Code）
echo "2️⃣ 复制 AionUI 到 VS Code..."
VSCODE_OUT="../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out"
AIONUI_SRC="extensions/aionui-main/out"

if [ ! -d "$VSCODE_OUT" ]; then
    echo "❌ VS Code 构建目录不存在，需要完整构建"
    echo "运行: npm run gulp vscode-darwin-arm64"
    exit 1
fi

# 删除旧的 AionUI
rm -rf "$VSCODE_OUT/aionui"

# 创建正确的目录结构并复制
mkdir -p "$VSCODE_OUT/aionui/dist"
cp -r "$AIONUI_SRC"/* "$VSCODE_OUT/aionui/dist/"

# 复制所有 node_modules（包含所有运行时依赖）
echo "   复制 node_modules（这可能需要一些时间）..."
mkdir -p "$VSCODE_OUT/aionui/node_modules"
cp -R "extensions/aionui-main/node_modules"/* "$VSCODE_OUT/aionui/node_modules/"

echo "✅ AionUI 已更新到 VS Code"
echo ""

echo "========================================="
echo "✅ 快速重建完成！"
echo "========================================="
echo ""
echo "现在可以测试："
echo "  ./test-vscode-aionui.sh"
echo ""

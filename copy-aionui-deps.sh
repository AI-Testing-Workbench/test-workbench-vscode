#!/bin/bash
# 复制 AionUI 的 node_modules 到 VS Code 构建目录

set -e

echo "========================================="
echo "复制 AionUI 依赖到 VS Code"
echo "========================================="
echo ""

VSCODE_AIONUI="../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui"
AIONUI_SRC="extensions/aionui-main"

if [ ! -d "$VSCODE_AIONUI" ]; then
    echo "❌ VS Code AionUI 目录不存在"
    exit 1
fi

echo "1. 复制 node_modules..."

# 创建 node_modules 目录（如果不存在）
mkdir -p "$VSCODE_AIONUI/node_modules"

# 复制关键的依赖包
echo "   复制 @office-ai/platform..."
cp -r "$AIONUI_SRC/node_modules/@office-ai" "$VSCODE_AIONUI/node_modules/" 2>/dev/null || echo "   ⚠️  @office-ai 已存在或复制失败"

echo "   复制其他依赖..."
# 复制所有依赖（这可能需要一些时间）
rsync -a --exclude='node_modules' "$AIONUI_SRC/node_modules/" "$VSCODE_AIONUI/node_modules/" 2>&1 | grep -v "^$" | head -10 || true

echo ""
echo "2. 验证关键依赖..."

if [ -d "$VSCODE_AIONUI/node_modules/@office-ai/platform" ]; then
    echo "✅ @office-ai/platform 已复制"
else
    echo "❌ @office-ai/platform 复制失败"
    exit 1
fi

echo ""
echo "========================================="
echo "✅ 依赖复制完成"
echo "========================================="
echo ""
echo "现在测试："
echo "  ./test-vscode-aionui.sh"
echo ""
echo "预期：后端应该可以正常初始化"

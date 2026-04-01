#!/bin/bash
# 测试 AionUI better-sqlite3 修复

echo "🔍 验证 better-sqlite3 模块..."
echo ""

VSCODE_PATH="../VSCode-darwin-arm64/Code - OSS.app"
SQLITE_PATH="$VSCODE_PATH/Contents/Resources/app/out/aionui/dist/main/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

# 检查文件是否存在
if [ ! -f "$SQLITE_PATH" ]; then
    echo "❌ 错误：better_sqlite3.node 未找到"
    echo "   路径：$SQLITE_PATH"
    exit 1
fi

echo "✅ 文件存在"

# 检查文件大小
SIZE=$(ls -lh "$SQLITE_PATH" | awk '{print $5}')
echo "📦 文件大小：$SIZE"

# 检查架构
ARCH_INFO=$(lipo -info "$SQLITE_PATH" 2>/dev/null)
if echo "$ARCH_INFO" | grep -q "arm64"; then
    echo "✅ 架构：arm64（正确）"
elif echo "$ARCH_INFO" | grep -q "x86_64"; then
    echo "❌ 架构：x86_64（错误，应该是 arm64）"
    exit 1
else
    echo "⚠️  架构信息：$ARCH_INFO"
fi

# 检查依赖
echo ""
echo "📚 依赖库："
otool -L "$SQLITE_PATH" | grep -v "$SQLITE_PATH:" | head -5

echo ""
echo "🎉 验证完成！"
echo ""
echo "要启动 VS Code 并测试 AionUI："
echo "  cd ../VSCode-darwin-arm64"
echo "  open 'Code - OSS.app'"
echo ""
echo "然后使用命令面板（Cmd+Shift+P）搜索 'AionUI' 来打开它。"

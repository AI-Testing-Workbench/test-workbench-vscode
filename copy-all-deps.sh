#!/bin/bash
# 复制所有 AionUI 运行时依赖

set -e

echo "========================================="
echo "复制 AionUI 所有依赖"
echo "========================================="
echo ""

VSCODE_AIONUI="../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui"
AIONUI_SRC="extensions/aionui-main"

if [ ! -d "$VSCODE_AIONUI" ]; then
    echo "❌ VS Code AionUI 目录不存在"
    exit 1
fi

echo "正在复制 node_modules..."
echo "这可能需要几分钟..."
echo ""

# 删除旧的 node_modules（保留 native 模块）
if [ -d "$VSCODE_AIONUI/node_modules" ]; then
    echo "保存 native 模块..."
    mkdir -p /tmp/aionui-native-backup
    if [ -d "$VSCODE_AIONUI/node_modules/better-sqlite3" ]; then
        cp -r "$VSCODE_AIONUI/node_modules/better-sqlite3" /tmp/aionui-native-backup/
    fi
    if [ -d "$VSCODE_AIONUI/node_modules/bindings" ]; then
        cp -r "$VSCODE_AIONUI/node_modules/bindings" /tmp/aionui-native-backup/
    fi
    if [ -d "$VSCODE_AIONUI/node_modules/file-uri-to-path" ]; then
        cp -r "$VSCODE_AIONUI/node_modules/file-uri-to-path" /tmp/aionui-native-backup/
    fi
fi

# 创建新的 node_modules
mkdir -p "$VSCODE_AIONUI/node_modules"

# 复制所有依赖（使用 rsync 更快）
echo "复制依赖包..."
rsync -a --info=progress2 "$AIONUI_SRC/node_modules/" "$VSCODE_AIONUI/node_modules/" 2>&1 | grep -v "^$" || true

# 恢复 native 模块（确保使用正确编译的版本）
if [ -d "/tmp/aionui-native-backup/better-sqlite3" ]; then
    echo "恢复 native 模块..."
    cp -r /tmp/aionui-native-backup/* "$VSCODE_AIONUI/node_modules/"
    rm -rf /tmp/aionui-native-backup
fi

echo ""
echo "========================================="
echo "验证关键依赖..."
echo "========================================="
echo ""

# 检查关键依赖
deps=(
    "@office-ai/platform"
    "eventemitter3"
    "better-sqlite3"
)

all_ok=true
for dep in "${deps[@]}"; do
    if [ -d "$VSCODE_AIONUI/node_modules/$dep" ]; then
        echo "✅ $dep"
    else
        echo "❌ $dep - 缺失"
        all_ok=false
    fi
done

echo ""

if [ "$all_ok" = true ]; then
    echo "========================================="
    echo "✅ 所有依赖已复制"
    echo "========================================="
    echo ""
    echo "node_modules 大小："
    du -sh "$VSCODE_AIONUI/node_modules"
    echo ""
    echo "现在测试："
    echo "  ./test-vscode-aionui.sh"
    echo ""
    echo "预期：后端应该可以正常初始化"
else
    echo "========================================="
    echo "❌ 有依赖缺失"
    echo "========================================="
fi

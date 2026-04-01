#!/bin/bash
# 验证 AionUI 目录结构

echo "========================================="
echo "验证 AionUI 目录结构"
echo "========================================="
echo ""

VSCODE_AIONUI="../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui"

echo "检查必需的文件..."
echo ""

# 检查主要文件
files=(
    "dist/main/index.cjs"
    "dist/preload/index.js"
    "dist/renderer/index.html"
)

all_ok=true

for file in "${files[@]}"; do
    full_path="$VSCODE_AIONUI/$file"
    if [ -f "$full_path" ]; then
        size=$(ls -lh "$full_path" | awk '{print $5}')
        echo "✅ $file (大小: $size)"
    else
        echo "❌ $file - 不存在"
        all_ok=false
    fi
done

echo ""

if [ "$all_ok" = true ]; then
    echo "========================================="
    echo "✅ 所有文件都存在"
    echo "========================================="
    echo ""

    # 检查 preload 中的 isVSCodeIntegration
    if grep -q "isVSCodeIntegration" "$VSCODE_AIONUI/dist/preload/index.js"; then
        echo "✅ preload 包含 isVSCodeIntegration 标志"
    else
        echo "❌ preload 不包含 isVSCodeIntegration 标志"
        all_ok=false
    fi

    echo ""

    if [ "$all_ok" = true ]; then
        echo "🎉 AionUI 结构正确，可以测试了！"
        echo ""
        echo "运行测试："
        echo "  ./test-vscode-aionui.sh"
    fi
else
    echo "========================================="
    echo "❌ 有文件缺失"
    echo "========================================="
    echo ""
    echo "请运行："
    echo "  ./quick-rebuild.sh"
fi


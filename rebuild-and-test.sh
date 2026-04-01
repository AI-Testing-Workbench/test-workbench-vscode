#!/bin/bash
# 重新构建 AionUI 和 VS Code，然后测试

set -e  # 遇到错误立即退出

echo "========================================="
echo "步骤 1: 重新构建 AionUI"
echo "========================================="
echo ""

cd extensions/aionui-main

echo "清理旧的构建..."
rm -rf out dist

echo "重新构建 AionUI..."
npm run package

if [ $? -ne 0 ]; then
    echo "❌ AionUI 构建失败"
    exit 1
fi

echo "✅ AionUI 构建完成"
echo ""

cd ../..

echo "========================================="
echo "步骤 2: 重新构建 VS Code"
echo "========================================="
echo ""

echo "开始构建 VS Code（这可能需要几分钟）..."
npm run gulp vscode-darwin-arm64

if [ $? -ne 0 ]; then
    echo "❌ VS Code 构建失败"
    exit 1
fi

echo "✅ VS Code 构建完成"
echo ""

echo "========================================="
echo "步骤 3: 验证构建"
echo "========================================="
echo ""

VSCODE_PATH="../VSCode-darwin-arm64/Code - OSS.app"

if [ ! -d "$VSCODE_PATH" ]; then
    echo "❌ VS Code 构建目录未找到：$VSCODE_PATH"
    exit 1
fi

echo "✅ VS Code 构建目录存在"

# 检查 AionUI 文件
AIONUI_MAIN="../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/dist/main/index.cjs"
if [ -f "$AIONUI_MAIN" ]; then
    echo "✅ AionUI 主进程文件存在"
    echo "   大小: $(ls -lh "$AIONUI_MAIN" | awk '{print $5}')"
else
    echo "❌ AionUI 主进程文件未找到"
fi

AIONUI_RENDERER="../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/dist/renderer/index.html"
if [ -f "$AIONUI_RENDERER" ]; then
    echo "✅ AionUI 渲染进程文件存在"
else
    echo "❌ AionUI 渲染进程文件未找到"
fi

echo ""
echo "========================================="
echo "构建完成！"
echo "========================================="
echo ""
echo "现在可以测试了："
echo "  1. 运行: ./test-vscode-aionui.sh"
echo "  2. 在 VS Code 中打开 AionUI"
echo "  3. 检查是否还有 sentry-ipc 错误"
echo ""

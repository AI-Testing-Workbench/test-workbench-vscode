#!/bin/bash
# 测试 Sentry 修复

echo "========================================="
echo "测试 Sentry 修复"
echo "========================================="
echo ""

echo "1. 检查 preload 文件中的 isVSCodeIntegration 标志..."
if grep -q "isVSCodeIntegration" "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/preload/index.js"; then
    echo "✅ preload 文件包含 isVSCodeIntegration 标志"
else
    echo "❌ preload 文件不包含 isVSCodeIntegration 标志"
    exit 1
fi

echo ""
echo "2. 检查文件更新时间..."
PRELOAD_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/preload/index.js")
echo "   Preload 文件时间: $PRELOAD_TIME"

RENDERER_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui/dist/renderer/index.html")
echo "   Renderer 文件时间: $RENDERER_TIME"

echo ""
echo "3. 启动 VS Code 进行测试..."
echo ""
echo "请在 VS Code 中："
echo "  1. 按 Cmd+Shift+P"
echo "  2. 搜索 'AionUI'"
echo "  3. 打开 AionUI 窗口"
echo "  4. 打开 DevTools (自动打开)"
echo "  5. 在 Console 中搜索 'sentry-ipc'"
echo ""
echo "预期结果："
echo "  ✅ 不应该看到任何 sentry-ipc 错误"
echo "  ✅ 应该看到 'electronAPI exists: true'"
echo "  ✅ 应该看到 Gemini agent"
echo ""

read -p "按 Enter 启动 VS Code..."

open "../VSCode-darwin-arm64/Code - OSS.app"

echo ""
echo "VS Code 已启动，请检查 AionUI 窗口的 DevTools"

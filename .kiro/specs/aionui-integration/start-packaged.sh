#!/bin/bash
# 启动打包版本的 VS Code（生产模式）

echo "======================================"
echo "  启动打包版本 VS Code"
echo "======================================"
echo ""

# 检查打包版本是否存在
if [ ! -d "../VSCode-darwin-arm64" ]; then
    echo "❌ 打包版本不存在"
    echo ""
    echo "请先运行以下命令创建打包版本："
    echo "  yarn gulp vscode-darwin-arm64-min"
    echo ""
    exit 1
fi

echo "✅ 找到打包版本"
echo ""
echo "启动中..."
echo ""

# 启动打包版本
../VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/MacOS/Code\ -\ OSS

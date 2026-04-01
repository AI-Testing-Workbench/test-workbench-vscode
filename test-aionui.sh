#!/bin/bash

# AionUI 测试脚本

echo "=== AionUI 集成测试 ==="
echo ""

# 步骤 1: 启动 AionUI 开发服务器
echo "步骤 1: 启动 AionUI 开发服务器"
echo "请在另一个终端运行:"
echo "  cd extensions/aionui-main"
echo "  bun run start"
echo ""
echo "等待看到 'Local: http://localhost:5173' 后按回车继续..."
read

# 步骤 2: 测试命令行启动
echo ""
echo "步骤 2: 测试命令行启动 AionUI"
echo "运行: ./scripts/code.sh --aionui"
echo ""
echo "预期结果:"
echo "  ✓ VS Code 启动"
echo "  ✓ 弹出一个新的 AionUI 窗口"
echo "  ✓ 窗口标题显示 'AionUI - AI Assistant'"
echo "  ✓ 窗口内容显示 AionUI 界面"
echo ""
echo "按回车启动..."
read

./scripts/code.sh --aionui

echo ""
echo "测试完成！"

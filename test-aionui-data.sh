#!/bin/bash
# test-workbench_change - new file
# 测试 AionUI 数据加载

echo "========================================="
echo "  AionUI 数据加载测试"
echo "========================================="
echo ""

# 关闭现有实例
echo "🔄 关闭现有实例..."
pkill -f "Code - OSS" 2>/dev/null
sleep 2

# 启动应用
echo "🚀 启动 AionUI..."
"../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui > /dev/null 2>&1 &
APP_PID=$!

echo "✅ 应用已启动 (PID: $APP_PID)"
echo ""
echo "等待 5 秒让应用完全加载..."
sleep 5

echo ""
echo "========================================="
echo "  测试步骤"
echo "========================================="
echo ""
echo "1. 打开 DevTools Console（应该已自动打开）"
echo ""
echo "2. 复制并运行以下诊断脚本:"
echo ""
cat diagnose-aionui.js
echo ""
echo "========================================="
echo ""
echo "3. 查看输出，特别注意:"
echo "   - electronAPI 是否存在"
echo "   - IPC 通信是否成功"
echo "   - localStorage 是否可访问"
echo "   - React 应用是否正确挂载"
echo ""
echo "4. 检查是否显示:"
echo "   ✅ 多智能体图标（✨ 🔄 等）"
echo "   ✅ 技能列表（Morph PPT, Star Office 等）"
echo ""
echo "如果仍然不显示，请将 Console 输出截图发给我！"
echo ""

#!/bin/bash

# 验证方案 2 实施脚本
# 用于检查构建产物和启动测试

set -e

echo "=========================================="
echo "方案 2 验证脚本"
echo "=========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1 (缺失)"
        return 1
    fi
}

check_dir() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1 (缺失)"
        return 1
    fi
}

# 步骤 1: 检查 AionUI 源码
echo "步骤 1: 检查 AionUI 源码"
echo "----------------------------------------"
check_file "extensions/aionui-main/package.json"
check_file "extensions/aionui-main/src/index.ts"
check_file "extensions/aionui-main/src/process/index.ts"
echo ""

# 步骤 2: 检查 VS Code 集成代码
echo "步骤 2: 检查 VS Code 集成代码"
echo "----------------------------------------"
check_file "src/vs/aionui/electron-main/aionuiWindowManager.js"
check_file "src/vs/aionui/common/aionui.ts"
check_file "src/vs/workbench/contrib/aionui/browser/aionui.contribution.ts"
echo ""

# 步骤 3: 检查 AionUI 构建产物
echo "步骤 3: 检查 AionUI 构建产物"
echo "----------------------------------------"
AIONUI_BUILT=true

if ! check_dir "out/aionui/dist"; then
    AIONUI_BUILT=false
fi

if ! check_file "out/aionui/dist/main/index.js"; then
    AIONUI_BUILT=false
fi

if ! check_file "out/aionui/dist/preload/index.js"; then
    AIONUI_BUILT=false
fi

if ! check_file "out/aionui/dist/renderer/index.html"; then
    AIONUI_BUILT=false
fi

if [ "$AIONUI_BUILT" = false ]; then
    echo ""
    echo -e "${YELLOW}警告: AionUI 构建产物不完整${NC}"
    echo "请运行以下命令重新构建："
    echo ""
    echo "  cd extensions/aionui-main"
    echo "  bun install"
    echo "  bun run package"
    echo "  cd ../.."
    echo ""
fi
echo ""

# 步骤 4: 检查 VS Code 构建产物
echo "步骤 4: 检查 VS Code 构建产物"
echo "----------------------------------------"
VSCODE_BUILT=false

# 检查不同平台的构建产物
if [ -d "VSCode-darwin-arm64" ]; then
    echo -e "${GREEN}✓${NC} VSCode-darwin-arm64 (macOS ARM64)"
    VSCODE_BUILT=true
    VSCODE_PATH="VSCode-darwin-arm64/Code OSS.app/Contents/MacOS/Electron"
elif [ -d "VSCode-darwin-x64" ]; then
    echo -e "${GREEN}✓${NC} VSCode-darwin-x64 (macOS x64)"
    VSCODE_BUILT=true
    VSCODE_PATH="VSCode-darwin-x64/Code OSS.app/Contents/MacOS/Electron"
elif [ -d "VSCode-linux-x64" ]; then
    echo -e "${GREEN}✓${NC} VSCode-linux-x64"
    VSCODE_BUILT=true
    VSCODE_PATH="VSCode-linux-x64/code-oss"
elif [ -d "VSCode-win32-x64" ]; then
    echo -e "${GREEN}✓${NC} VSCode-win32-x64"
    VSCODE_BUILT=true
    VSCODE_PATH="VSCode-win32-x64/Code.exe"
else
    echo -e "${RED}✗${NC} 未找到 VS Code 构建产物"
    echo ""
    echo -e "${YELLOW}请运行以下命令构建 VS Code:${NC}"
    echo ""
    echo "  yarn gulp vscode-darwin-min    # macOS"
    echo "  yarn gulp vscode-linux-min     # Linux"
    echo "  yarn gulp vscode-win32-min     # Windows"
    echo ""
fi
echo ""

# 步骤 5: 检查关键文件内容
echo "步骤 5: 检查关键代码修改"
echo "----------------------------------------"

if grep -q "initializeProcess" "src/vs/aionui/electron-main/aionuiWindowManager.js"; then
    echo -e "${GREEN}✓${NC} aionuiWindowManager.js 包含 initializeProcess 调用"
else
    echo -e "${RED}✗${NC} aionuiWindowManager.js 缺少 initializeProcess 调用"
fi

if grep -q "setupFallbackIpcHandler" "src/vs/aionui/electron-main/aionuiWindowManager.js"; then
    echo -e "${GREEN}✓${NC} aionuiWindowManager.js 包含 fallback 机制"
else
    echo -e "${RED}✗${NC} aionuiWindowManager.js 缺少 fallback 机制"
fi

if grep -q "backend: 'gemini'" "src/vs/aionui/electron-main/aionuiWindowManager.js"; then
    echo -e "${GREEN}✓${NC} MinimalDataProvider 返回 Gemini 智能体"
else
    echo -e "${RED}✗${NC} MinimalDataProvider 未返回 Gemini 智能体"
fi
echo ""

# 步骤 6: 提供启动命令
echo "步骤 6: 启动测试"
echo "----------------------------------------"

if [ "$VSCODE_BUILT" = true ]; then
    echo "使用以下命令启动 VS Code 并打开 AionUI:"
    echo ""
    echo -e "${GREEN}  \"$VSCODE_PATH\" --aionui${NC}"
    echo ""
    echo "或者先启动 VS Code，然后使用命令面板:"
    echo ""
    echo -e "${GREEN}  \"$VSCODE_PATH\"${NC}"
    echo "  然后按 Cmd+Shift+P (macOS) 或 Ctrl+Shift+P (Windows/Linux)"
    echo "  输入: Open AionUI Window"
    echo ""
else
    echo -e "${YELLOW}请先构建 VS Code${NC}"
fi

# 步骤 7: 验证清单
echo "=========================================="
echo "验证清单"
echo "=========================================="
echo ""
echo "启动后，请检查以下内容:"
echo ""
echo "1. DevTools 自动打开（用于查看日志）"
echo ""
echo "2. 查看控制台日志，确认初始化状态:"
echo "   - 完整模式: '✅ AionUI backend initialized successfully'"
echo "   - Fallback 模式: 'falling back to minimal data provider'"
echo ""
echo "3. 首页应该显示:"
echo "   - 智能体列表（至少有 Gemini）"
echo "   - 助手列表（20 个内置助手）"
echo "   - 不应该显示'加载中'"
echo ""
echo "4. 在 DevTools 控制台测试 IPC:"
echo ""
echo "   window.electronAPI.emit('subscribe-acp.get-available-agents', { id: 'test' })"
echo "     .then(r => console.log('✅ Agents:', r.data))"
echo ""
echo "5. 尝试与 Gemini 对话，确认功能正常"
echo ""
echo "=========================================="
echo "如有问题，请查看:"
echo "  .kiro/specs/aionui-integration/SOLUTION_2_IMPLEMENTATION.md"
echo "=========================================="

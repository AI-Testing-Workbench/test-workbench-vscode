#!/bin/bash

# 验证打包后的应用是否包含所有必需的 AionUI 文件

APP_PATH="$HOME/VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app"
AIONUI_PATH="$APP_PATH/out/aionui"

echo "========================================="
echo "验证 AionUI 打包文件"
echo "========================================="
echo ""

echo "检查路径: $AIONUI_PATH"
echo ""

# 检查目录是否存在
if [ ! -d "$AIONUI_PATH" ]; then
    echo "❌ 错误: AionUI 目录不存在"
    exit 1
fi

echo "✅ AionUI 目录存在"
echo ""

# 检查必需的文件和目录
echo "检查必需的文件和目录:"
echo ""

check_item() {
    local item=$1
    local type=$2
    local path="$AIONUI_PATH/$item"

    if [ "$type" = "dir" ]; then
        if [ -d "$path" ]; then
            echo "✅ $item/ (目录)"
            return 0
        else
            echo "❌ $item/ (目录不存在)"
            return 1
        fi
    else
        if [ -f "$path" ]; then
            echo "✅ $item (文件)"
            return 0
        else
            echo "❌ $item (文件不存在)"
            return 1
        fi
    fi
}

# 检查所有必需的项目
all_ok=true

check_item "dist" "dir" || all_ok=false
check_item "resources" "dir" || all_ok=false
check_item "node_modules" "dir" || all_ok=false
check_item "package.json" "file" || all_ok=false

echo ""

# 检查 node_modules 中的关键依赖
if [ -d "$AIONUI_PATH/node_modules" ]; then
    echo "检查关键依赖:"
    echo ""

    check_dependency() {
        local dep=$1
        if [ -d "$AIONUI_PATH/node_modules/$dep" ]; then
            echo "✅ $dep"
            return 0
        else
            echo "❌ $dep (缺失)"
            return 1
        fi
    }

    check_dependency "fix-path" || all_ok=false
    check_dependency "execa" || all_ok=false
    check_dependency "electron-log" || all_ok=false

    echo ""
fi

# 检查 dist 目录结构
if [ -d "$AIONUI_PATH/dist" ]; then
    echo "检查 dist 目录结构:"
    echo ""

    check_item "dist/main" "dir" || all_ok=false
    check_item "dist/preload" "dir" || all_ok=false
    check_item "dist/renderer" "dir" || all_ok=false

    echo ""
fi

# 最终结果
echo "========================================="
if [ "$all_ok" = true ]; then
    echo "✅ 所有文件检查通过！"
    echo "========================================="
    exit 0
else
    echo "❌ 部分文件缺失，需要重新打包"
    echo "========================================="
    exit 1
fi

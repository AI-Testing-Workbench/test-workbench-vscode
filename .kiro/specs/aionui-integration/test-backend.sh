#!/bin/bash

# 测试 AionUI 后端是否成功加载

echo "=== 检查 AionUI 文件 ==="
echo ""

APP_PATH="VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/out/aionui"

echo "1. 检查主进程文件:"
if [ -f "$APP_PATH/dist/main/index.cjs" ]; then
    echo "   ✅ index.cjs 存在"
    ls -lh "$APP_PATH/dist/main/index.cjs"
else
    echo "   ❌ index.cjs 不存在"
fi

echo ""
echo "2. 检查 node_modules:"
if [ -d "$APP_PATH/node_modules" ]; then
    echo "   ✅ node_modules 存在"
    echo "   包数量: $(ls -1 "$APP_PATH/node_modules" | wc -l)"
    echo "   前 10 个包:"
    ls -1 "$APP_PATH/node_modules" | head -10
else
    echo "   ❌ node_modules 不存在"
fi

echo ""
echo "3. 检查 package.json:"
if [ -f "$APP_PATH/package.json" ]; then
    echo "   ✅ package.json 存在"
    cat "$APP_PATH/package.json"
else
    echo "   ❌ package.json 不存在"
fi

echo ""
echo "4. 检查渲染进程文件:"
if [ -f "$APP_PATH/dist/renderer/index.html" ]; then
    echo "   ✅ index.html 存在"
else
    echo "   ❌ index.html 不存在"
fi

if [ -f "$APP_PATH/dist/preload/index.js" ]; then
    echo "   ✅ preload.js 存在"
else
    echo "   ❌ preload.js 不存在"
fi

echo ""
echo "=== 检查主进程日志 ==="
echo ""

LOG_DIR="$HOME/Library/Application Support/Code - OSS/logs"
LATEST_LOG=$(ls -t "$LOG_DIR" | head -1)

echo "最新日志目录: $LATEST_LOG"
echo ""

echo "搜索后端初始化相关日志:"
grep -i "aionui.*backend\|aionui.*initialize\|aionui.*process.*module" "$LOG_DIR/$LATEST_LOG/main.log" 2>/dev/null || echo "   没有找到相关日志"

echo ""
echo "搜索错误日志:"
grep -i "aionui.*error\|aionui.*failed" "$LOG_DIR/$LATEST_LOG/main.log" 2>/dev/null || echo "   没有找到错误日志"

echo ""
echo "=== 完成 ==="

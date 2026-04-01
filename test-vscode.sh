#!/bin/bash
# Test script to launch VS Code and check for errors

cd "../VSCode-darwin-arm64"
"./Code - OSS.app/Contents/MacOS/Code - OSS" --aionui > /tmp/vscode-test.log 2>&1 &
PID=$!

echo "Launched VS Code with PID: $PID"
echo "Waiting 5 seconds for startup..."
sleep 5

echo ""
echo "=== Last 50 lines of log ==="
tail -50 /tmp/vscode-test.log

echo ""
echo "=== Checking for AionUI-related messages ==="
grep -i "aionui" /tmp/vscode-test.log || echo "No AionUI messages found"

echo ""
echo "=== Checking for errors ==="
grep -i "error" /tmp/vscode-test.log | head -20 || echo "No errors found"

# Kill the process
kill $PID 2>/dev/null

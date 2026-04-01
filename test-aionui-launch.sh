#!/bin/bash
# test-workbench_change - new file
# Test AionUI launch and capture logs

echo "🚀 Launching AionUI..."
echo ""

# Launch and capture output for 5 seconds
timeout 5s "../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Electron" --aionui 2>&1 || true

echo ""
echo "✅ Launch test complete"

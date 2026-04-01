#!/bin/bash
# test-workbench_change - new file
# Quick build script for VS Code with AionUI
# This is a simplified version that builds for the current platform

set -e

echo "🚀 Quick Build: VS Code with AionUI"
echo ""

# Detect platform
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$PLATFORM" in
    darwin) PLATFORM="darwin" ;;
    linux) PLATFORM="linux" ;;
    *) echo "❌ Unsupported platform"; exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) echo "❌ Unsupported architecture"; exit 1 ;;
esac

echo "📦 Building for: $PLATFORM-$ARCH"
echo ""

# Build AionUI
echo "1️⃣  Building AionUI..."
cd extensions/aionui-main
bun run package || npm run package
cd ../..
echo "✅ AionUI built"
echo ""

# Package VS Code
echo "2️⃣  Packaging VS Code..."
npm run gulp "vscode-$PLATFORM-$ARCH"
echo "✅ VS Code packaged"
echo ""

# Show result
OUTPUT="../VSCode-$PLATFORM-$ARCH"
echo "🎉 Build complete!"
echo ""
echo "📍 Location: $OUTPUT"
echo ""
echo "🧪 Test with:"
if [ "$PLATFORM" = "darwin" ]; then
    echo "   cd $OUTPUT && ./Code\\ -\\ OSS.app/Contents/MacOS/Electron --aionui"
else
    echo "   cd $OUTPUT && ./code --aionui"
fi
echo ""

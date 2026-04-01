#!/bin/bash
# test-workbench_change - new file
# Verify AionUI resources are packaged correctly

set -e

echo "🔍 Verifying AionUI resources in packaged application..."

# Find the packaged application directory
PACKAGE_DIR=$(find .. -maxdepth 1 -type d -name "VSCode-*" | head -n 1)

if [ -z "$PACKAGE_DIR" ]; then
    echo "❌ No packaged application found"
    exit 1
fi

echo "📦 Found package: $PACKAGE_DIR"

# Determine the app resources path based on platform
if [ -d "$PACKAGE_DIR/Code - OSS.app" ]; then
    # macOS
    APP_PATH="$PACKAGE_DIR/Code - OSS.app/Contents/Resources/app"
    echo "🍎 Detected macOS package"
elif [ -d "$PACKAGE_DIR/resources" ]; then
    # Linux/Windows
    APP_PATH="$PACKAGE_DIR/resources/app"
    echo "🐧 Detected Linux/Windows package"
else
    APP_PATH="$PACKAGE_DIR"
    echo "⚠️  Using package root as app path"
fi

# Check for AionUI dist directory
if [ -d "$APP_PATH/out/aionui/dist" ]; then
    echo "✅ AionUI dist directory found"

    # Check for main files
    if [ -f "$APP_PATH/out/aionui/dist/main/index.js" ]; then
        echo "✅ AionUI main/index.js found"
    else
        echo "❌ AionUI main/index.js NOT found"
        exit 1
    fi

    # Check for preload files
    if [ -f "$APP_PATH/out/aionui/dist/preload/index.js" ]; then
        echo "✅ AionUI preload/index.js found"
    else
        echo "❌ AionUI preload/index.js NOT found"
        exit 1
    fi

    # Check for renderer files
    if [ -f "$APP_PATH/out/aionui/dist/renderer/index.html" ]; then
        echo "✅ AionUI renderer/index.html found"
    else
        echo "❌ AionUI renderer/index.html NOT found"
        exit 1
    fi

    # List all AionUI files
    echo ""
    echo "📋 AionUI files in package:"
    find "$APP_PATH/out/aionui" -type f | head -n 20

else
    echo "❌ AionUI dist directory NOT found at: $APP_PATH/out/aionui/dist"
    exit 1
fi

# Check for AionUI resources directory
if [ -d "$APP_PATH/out/aionui/resources" ]; then
    echo "✅ AionUI resources directory found"
    RESOURCE_COUNT=$(find "$APP_PATH/out/aionui/resources" -type f | wc -l)
    echo "   Found $RESOURCE_COUNT resource files"
else
    echo "⚠️  AionUI resources directory NOT found (may be empty)"
fi

# Check for AionUI integration files
if [ -d "$APP_PATH/out/vs/aionui" ]; then
    echo "✅ AionUI integration files found"
    if [ -f "$APP_PATH/out/vs/aionui/electron-main/aionuiWindowManager.js" ]; then
        echo "✅ AionUI window manager found"
    fi
else
    echo "⚠️  AionUI integration files NOT found"
fi

echo ""
echo "✅ AionUI packaging verification completed successfully!"

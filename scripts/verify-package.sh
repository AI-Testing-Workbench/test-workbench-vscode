#!/bin/bash
# test-workbench_change - new file
# Verify VS Code + AionUI package
# This script checks if the package was built correctly

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_check() {
    echo -e "${CYAN}[CHECK]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_fail() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

# Detect platform and architecture
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$PLATFORM" in
    darwin) PLATFORM="darwin" ;;
    linux) PLATFORM="linux" ;;
    mingw*|msys*|cygwin*) PLATFORM="win32" ;;
    *) echo "Unsupported platform"; exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    armv7l) ARCH="armhf" ;;
    *) echo "Unsupported architecture"; exit 1 ;;
esac

# Allow override via command line
if [ -n "$1" ]; then
    PLATFORM="$1"
fi

if [ -n "$2" ]; then
    ARCH="$2"
fi

PACKAGE_DIR="../VSCode-$PLATFORM-$ARCH"

echo ""
echo "🔍 Verifying VS Code + AionUI Package"
echo ""
echo "Platform: $PLATFORM-$ARCH"
echo "Package directory: $PACKAGE_DIR"
echo ""

# Check if package directory exists
print_check "Checking if package directory exists..."
if [ -d "$PACKAGE_DIR" ]; then
    print_pass "Package directory found"
else
    print_fail "Package directory not found: $PACKAGE_DIR"
    echo ""
    echo "Please run the build script first:"
    echo "  ./scripts/quick-build.sh"
    exit 1
fi

# Determine paths based on platform
case "$PLATFORM" in
    darwin)
        APP_PATH="$PACKAGE_DIR/Code - OSS.app"
        RESOURCES_PATH="$APP_PATH/Contents/Resources/app"
        EXECUTABLE_PATH="$APP_PATH/Contents/MacOS/Electron"
        ;;
    win32)
        RESOURCES_PATH="$PACKAGE_DIR/resources/app"
        EXECUTABLE_PATH="$PACKAGE_DIR/Code.exe"
        ;;
    linux)
        RESOURCES_PATH="$PACKAGE_DIR/resources/app"
        EXECUTABLE_PATH="$PACKAGE_DIR/code"
        ;;
esac

# Check VS Code executable
print_check "Checking VS Code executable..."
if [ -f "$EXECUTABLE_PATH" ]; then
    print_pass "VS Code executable found"
else
    print_fail "VS Code executable not found: $EXECUTABLE_PATH"
fi

# Check AionUI directory
print_check "Checking AionUI directory..."
AIONUI_PATH="$RESOURCES_PATH/extensions/aionui-main"
if [ -d "$AIONUI_PATH" ]; then
    print_pass "AionUI directory found"
else
    print_fail "AionUI directory not found: $AIONUI_PATH"
    exit 1
fi

# Check AionUI build output
print_check "Checking AionUI build output..."
AIONUI_OUT="$AIONUI_PATH/out"
if [ -d "$AIONUI_OUT" ]; then
    print_pass "AionUI build output found"

    # Check subdirectories
    if [ -d "$AIONUI_OUT/main" ]; then
        print_pass "  - main/ directory found"
    else
        print_fail "  - main/ directory missing"
    fi

    if [ -d "$AIONUI_OUT/preload" ]; then
        print_pass "  - preload/ directory found"
    else
        print_fail "  - preload/ directory missing"
    fi

    if [ -d "$AIONUI_OUT/renderer" ]; then
        print_pass "  - renderer/ directory found"
    else
        print_fail "  - renderer/ directory missing"
    fi
else
    print_fail "AionUI build output not found: $AIONUI_OUT"
    exit 1
fi

# Check AionUI main entry point
print_check "Checking AionUI main entry point..."
AIONUI_MAIN="$AIONUI_OUT/main/index.js"
if [ -f "$AIONUI_MAIN" ]; then
    print_pass "AionUI main entry point found"
else
    print_fail "AionUI main entry point not found: $AIONUI_MAIN"
fi

# Check AionUI node_modules
print_check "Checking AionUI node_modules..."
AIONUI_NODE_MODULES="$AIONUI_PATH/node_modules"
if [ -d "$AIONUI_NODE_MODULES" ]; then
    print_pass "AionUI node_modules found"

    # Check for electron
    ELECTRON_BIN="$AIONUI_NODE_MODULES/.bin/electron"
    if [ "$PLATFORM" = "win32" ]; then
        ELECTRON_BIN="$ELECTRON_BIN.cmd"
    fi

    if [ -f "$ELECTRON_BIN" ]; then
        print_pass "  - Electron executable found"
    else
        print_warn "  - Electron executable not found (may be normal for some builds)"
    fi
else
    print_warn "AionUI node_modules not found (may be normal for some builds)"
fi

# Check AionUI package.json
print_check "Checking AionUI package.json..."
AIONUI_PACKAGE_JSON="$AIONUI_PATH/package.json"
if [ -f "$AIONUI_PACKAGE_JSON" ]; then
    print_pass "AionUI package.json found"

    # Extract version
    if command -v node >/dev/null 2>&1; then
        VERSION=$(node -p "require('$AIONUI_PACKAGE_JSON').version" 2>/dev/null || echo "unknown")
        echo "  Version: $VERSION"
    fi
else
    print_fail "AionUI package.json not found: $AIONUI_PACKAGE_JSON"
fi

# Check VS Code integration files
print_check "Checking VS Code integration files..."
INTEGRATION_PATH="$RESOURCES_PATH/out/vs/aionui"
if [ -d "$INTEGRATION_PATH" ]; then
    print_pass "VS Code integration directory found"

    # Check for window manager
    WINDOW_MANAGER="$INTEGRATION_PATH/electron-main/aionuiWindowManager.js"
    if [ -f "$WINDOW_MANAGER" ]; then
        print_pass "  - AionUI window manager found"
    else
        print_fail "  - AionUI window manager not found"
    fi

    # Check for common types
    COMMON_TYPES="$INTEGRATION_PATH/common/aionui.js"
    if [ -f "$COMMON_TYPES" ]; then
        print_pass "  - AionUI common types found"
    else
        print_warn "  - AionUI common types not found (may be bundled)"
    fi
else
    print_fail "VS Code integration directory not found: $INTEGRATION_PATH"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Verification complete!"
echo ""
echo "📍 Package location: $PACKAGE_DIR"
echo ""
echo "🧪 Test commands:"
echo ""

case "$PLATFORM" in
    darwin)
        echo "  # Command line test:"
        echo "  cd \"$PACKAGE_DIR\""
        echo "  ./Code\\ -\\ OSS.app/Contents/MacOS/Electron --aionui"
        echo ""
        echo "  # Or use code command:"
        echo "  ./Code\\ -\\ OSS.app/Contents/Resources/app/bin/code --aionui"
        ;;
    win32)
        echo "  # Command line test:"
        echo "  cd \"$PACKAGE_DIR\""
        echo "  Code.exe --aionui"
        ;;
    linux)
        echo "  # Command line test:"
        echo "  cd \"$PACKAGE_DIR\""
        echo "  ./code --aionui"
        ;;
esac

echo ""
echo "  # Command palette test:"
echo "  1. Launch VS Code (without --aionui)"
echo "  2. Press Cmd+Shift+P (macOS) or Ctrl+Shift+P (Windows/Linux)"
echo "  3. Type 'Open AionUI Window' and press Enter"
echo ""

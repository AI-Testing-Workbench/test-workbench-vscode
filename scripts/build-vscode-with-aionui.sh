#!/bin/bash
# test-workbench_change - new file
# Build VS Code with AionUI Integration
# This script automates the process of building and packaging VS Code with AionUI

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect platform and architecture
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$PLATFORM" in
    darwin)
        PLATFORM="darwin"
        ;;
    linux)
        PLATFORM="linux"
        ;;
    mingw*|msys*|cygwin*)
        PLATFORM="win32"
        ;;
    *)
        print_error "Unsupported platform: $PLATFORM"
        exit 1
        ;;
esac

case "$ARCH" in
    x86_64|amd64)
        ARCH="x64"
        ;;
    arm64|aarch64)
        ARCH="arm64"
        ;;
    armv7l)
        ARCH="armhf"
        ;;
    *)
        print_error "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

print_info "Detected platform: $PLATFORM-$ARCH"

# Parse command line arguments
SKIP_AIONUI_BUILD=false
SKIP_VSCODE_BUILD=false
CUSTOM_PLATFORM=""
CUSTOM_ARCH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-aionui)
            SKIP_AIONUI_BUILD=true
            shift
            ;;
        --skip-vscode)
            SKIP_VSCODE_BUILD=true
            shift
            ;;
        --platform)
            CUSTOM_PLATFORM="$2"
            shift 2
            ;;
        --arch)
            CUSTOM_ARCH="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-aionui       Skip AionUI build step"
            echo "  --skip-vscode       Skip VS Code build step"
            echo "  --platform PLATFORM Override platform (darwin, linux, win32)"
            echo "  --arch ARCH         Override architecture (x64, arm64, armhf)"
            echo "  --help              Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Build for current platform"
            echo "  $0 --platform darwin --arch arm64     # Build for macOS ARM64"
            echo "  $0 --skip-aionui                      # Skip AionUI build"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Override platform/arch if specified
if [ -n "$CUSTOM_PLATFORM" ]; then
    PLATFORM="$CUSTOM_PLATFORM"
fi

if [ -n "$CUSTOM_ARCH" ]; then
    ARCH="$CUSTOM_ARCH"
fi

print_info "Building for: $PLATFORM-$ARCH"

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
AIONUI_DIR="$ROOT_DIR/extensions/aionui-main"
OUTPUT_DIR="$( cd "$ROOT_DIR/.." && pwd )/VSCode-$PLATFORM-$ARCH"

echo ""
print_info "=== Building VS Code with AionUI ==="
echo ""
print_info "Root directory: $ROOT_DIR"
print_info "AionUI directory: $AIONUI_DIR"
print_info "Output directory: $OUTPUT_DIR"
echo ""

# Step 1: Build AionUI
if [ "$SKIP_AIONUI_BUILD" = false ]; then
    print_info "Step 1: Building AionUI..."

    if [ ! -d "$AIONUI_DIR" ]; then
        print_error "AionUI directory not found: $AIONUI_DIR"
        exit 1
    fi

    cd "$AIONUI_DIR"

    # Check if bun is available
    if command_exists bun; then
        print_info "Using bun to build AionUI..."

        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            print_info "Installing AionUI dependencies..."
            bun install
        fi

        # Build AionUI
        print_info "Running AionUI build..."
        bun run package
    elif command_exists npm; then
        print_warning "Bun not found, falling back to npm..."

        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            print_info "Installing AionUI dependencies..."
            npm install
        fi

        # Build AionUI
        print_info "Running AionUI build..."
        npm run package
    else
        print_error "Neither bun nor npm found. Please install one of them."
        exit 1
    fi

    # Verify build output
    if [ ! -d "out" ]; then
        print_error "AionUI build failed: out directory not found"
        exit 1
    fi

    print_success "AionUI build completed"
    cd "$ROOT_DIR"
else
    print_warning "Skipping AionUI build (--skip-aionui specified)"

    # Verify existing build
    if [ ! -d "$AIONUI_DIR/out" ]; then
        print_error "AionUI build not found. Please build AionUI first or remove --skip-aionui flag."
        exit 1
    fi
fi

echo ""

# Step 2: Package VS Code
if [ "$SKIP_VSCODE_BUILD" = false ]; then
    print_info "Step 2: Packaging VS Code..."

    cd "$ROOT_DIR"

    # Check if npm is available
    if ! command_exists npm; then
        print_error "npm not found. Please install Node.js and npm."
        exit 1
    fi

    # Install VS Code dependencies if needed
    if [ ! -d "node_modules" ]; then
        print_info "Installing VS Code dependencies..."
        npm install
    fi

    # Run gulp build task
    GULP_TASK="vscode-$PLATFORM-$ARCH"
    print_info "Running gulp task: $GULP_TASK"
    npm run gulp "$GULP_TASK"

    print_success "VS Code packaging completed"
else
    print_warning "Skipping VS Code build (--skip-vscode specified)"
fi

echo ""

# Step 3: Verify package
print_info "Step 3: Verifying package..."

if [ ! -d "$OUTPUT_DIR" ]; then
    print_error "Output directory not found: $OUTPUT_DIR"
    exit 1
fi

# Check for AionUI files in package
case "$PLATFORM" in
    darwin)
        AIONUI_PATH="$OUTPUT_DIR/Code - OSS.app/Contents/Resources/app/extensions/aionui-main"
        ;;
    win32)
        AIONUI_PATH="$OUTPUT_DIR/resources/app/extensions/aionui-main"
        ;;
    linux)
        AIONUI_PATH="$OUTPUT_DIR/resources/app/extensions/aionui-main"
        ;;
esac

if [ -d "$AIONUI_PATH/out" ]; then
    print_success "✓ AionUI files found in package"
    print_info "  Location: $AIONUI_PATH"
else
    print_error "✗ AionUI files NOT found in package"
    print_error "  Expected location: $AIONUI_PATH"
    exit 1
fi

# Check for electron executable
if [ -f "$AIONUI_PATH/node_modules/.bin/electron" ] || [ -f "$AIONUI_PATH/node_modules/.bin/electron.cmd" ]; then
    print_success "✓ Electron executable found"
else
    print_warning "⚠ Electron executable not found (this may be normal for some build configurations)"
fi

echo ""
print_success "=== Build Complete ==="
echo ""
print_info "Package location: $OUTPUT_DIR"
echo ""

# Print test instructions
print_info "To test AionUI integration:"
echo ""

case "$PLATFORM" in
    darwin)
        echo "  cd \"$OUTPUT_DIR\""
        echo "  ./Code\\ -\\ OSS.app/Contents/MacOS/Electron --aionui"
        echo ""
        echo "Or use the code command:"
        echo "  ./Code\\ -\\ OSS.app/Contents/Resources/app/bin/code --aionui"
        ;;
    win32)
        echo "  cd \"$OUTPUT_DIR\""
        echo "  Code.exe --aionui"
        ;;
    linux)
        echo "  cd \"$OUTPUT_DIR\""
        echo "  ./code --aionui"
        ;;
esac

echo ""
print_info "Or test via command palette:"
echo "  1. Launch VS Code (without --aionui)"
echo "  2. Press Cmd+Shift+P (macOS) or Ctrl+Shift+P (Windows/Linux)"
echo "  3. Type 'Open AionUI Window' and press Enter"
echo ""

print_success "Done!"

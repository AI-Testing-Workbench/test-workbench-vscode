#!/bin/bash
# test-workbench_change - new file
# Build VS Code with OpenWork Integration
# This script automates the process of building and packaging VS Code with OpenWork

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
SKIP_OPENWORK_BUILD=false
SKIP_VSCODE_BUILD=false
CREATE_DMG=false
CUSTOM_PLATFORM=""
CUSTOM_ARCH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-openwork)
            SKIP_OPENWORK_BUILD=true
            shift
            ;;
        --skip-vscode)
            SKIP_VSCODE_BUILD=true
            shift
            ;;
        --dmg)
            CREATE_DMG=true
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
            echo "  --skip-openwork     Skip OpenWork build step"
            echo "  --skip-vscode       Skip VS Code build step"
            echo "  --dmg               Create DMG installer (macOS only)"
            echo "  --platform PLATFORM Override platform (darwin, linux, win32)"
            echo "  --arch ARCH         Override architecture (x64, arm64, armhf)"
            echo "  --help              Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Build for current platform"
            echo "  $0 --dmg                              # Build and create DMG"
            echo "  $0 --platform darwin --arch arm64     # Build for macOS ARM64"
            echo "  $0 --skip-openwork                    # Skip OpenWork build"
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
OPENWORK_DIR="$ROOT_DIR/extensions/openwork-dev"
BUILD_DIR="$( cd "$ROOT_DIR/.." && pwd )"
OUTPUT_DIR="$BUILD_DIR/VSCode-darwin-$ARCH"

echo ""
print_info "=== Building VS Code with OpenWork ==="
echo ""
print_info "Root directory: $ROOT_DIR"
print_info "OpenWork directory: $OPENWORK_DIR"
print_info "Build directory: $BUILD_DIR"
print_info "Output directory: $OUTPUT_DIR"
echo ""

# Step 1: Build OpenWork
if [ "$SKIP_OPENWORK_BUILD" = false ]; then
    print_info "Step 1: Building OpenWork..."

    if [ ! -d "$OPENWORK_DIR" ]; then
        print_error "OpenWork directory not found: $OPENWORK_DIR"
        exit 1
    fi

    cd "$OPENWORK_DIR"

    # Check if pnpm is available
    if ! command_exists pnpm; then
        print_error "pnpm not found. Please install pnpm: npm install -g pnpm"
        exit 1
    fi

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        print_info "Installing OpenWork dependencies..."
        pnpm install
    fi

    # Build OpenWork UI
    print_info "Running OpenWork build..."
    pnpm run build:ui

    # Verify build output
    if [ ! -d "apps/app/dist" ]; then
        print_error "OpenWork build failed: apps/app/dist directory not found"
        exit 1
    fi

    print_success "OpenWork build completed"
    cd "$ROOT_DIR"
else
    print_warning "Skipping OpenWork build (--skip-openwork specified)"

    # Verify existing build
    if [ ! -d "$OPENWORK_DIR/apps/app/dist" ]; then
        print_error "OpenWork build not found. Please build OpenWork first or remove --skip-openwork flag."
        exit 1
    fi
fi

echo ""

# Step 2: Copy OpenWork build to VS Code output
print_info "Step 2: Copying OpenWork build artifacts..."

cd "$ROOT_DIR"

# Create output directory
mkdir -p out/openwork/dist
mkdir -p out/openwork/resources

# Copy build artifacts
print_info "Copying from $OPENWORK_DIR/apps/app/dist/ to out/openwork/dist/"
cp -r "$OPENWORK_DIR/apps/app/dist/"* out/openwork/dist/

# Copy resources
if [ -f "$OPENWORK_DIR/openwork-logo-transparent.svg" ]; then
    cp "$OPENWORK_DIR/openwork-logo-transparent.svg" out/openwork/resources/app.svg
    print_success "✓ Copied OpenWork logo"
fi

print_success "OpenWork artifacts copied"

echo ""

# Step 3: Compile VS Code TypeScript
print_info "Step 3: Compiling VS Code TypeScript..."

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

# Compile TypeScript (without mangling to avoid optimization errors)
print_info "Running TypeScript compilation..."
npm run gulp compile-build-without-mangling

print_success "TypeScript compilation completed"

echo ""

# Step 4: Package VS Code
if [ "$SKIP_VSCODE_BUILD" = false ]; then
    print_info "Step 4: Packaging VS Code..."

    cd "$ROOT_DIR"

    # Run gulp build task
    GULP_TASK="vscode-$PLATFORM-$ARCH"
    print_info "Running gulp task: $GULP_TASK"

    # Set environment variables for build
    export VSCODE_ARCH="$ARCH"
    export VSCODE_QUALITY="oss"

    npm run gulp "$GULP_TASK"

    print_success "VS Code packaging completed"
else
    print_warning "Skipping VS Code build (--skip-vscode specified)"
fi

echo ""

# Step 5: Create DMG (macOS only)
if [ "$CREATE_DMG" = true ]; then
    if [ "$PLATFORM" != "darwin" ]; then
        print_warning "DMG creation is only supported on macOS, skipping..."
    else
        print_info "Step 5: Creating DMG installer..."

        cd "$ROOT_DIR"

        # Create DMG output directory
        DMG_OUT_DIR="$BUILD_DIR/vscode_client_darwin_${ARCH}_dmg"
        mkdir -p "$DMG_OUT_DIR"

        print_info "Running DMG creation script..."
        node build/darwin/create-dmg.ts "$BUILD_DIR" "$DMG_OUT_DIR"

        if [ -f "$DMG_OUT_DIR/VSCode-darwin-$ARCH.dmg" ]; then
            print_success "✓ DMG created: $DMG_OUT_DIR/VSCode-darwin-$ARCH.dmg"

            # Get DMG size
            DMG_SIZE=$(du -h "$DMG_OUT_DIR/VSCode-darwin-$ARCH.dmg" | cut -f1)
            print_info "  DMG size: $DMG_SIZE"
        else
            print_error "✗ DMG creation failed"
            exit 1
        fi

        echo ""
    fi
fi

# Step 6: Verify package
print_info "Step 6: Verifying package..."

if [ ! -d "$OUTPUT_DIR" ]; then
    print_error "Output directory not found: $OUTPUT_DIR"
    exit 1
fi

# Check for OpenWork files in package
case "$PLATFORM" in
    darwin)
        OPENWORK_PATH="$OUTPUT_DIR/Code - OSS.app/Contents/Resources/app/out/openwork"
        ;;
    win32)
        OPENWORK_PATH="$OUTPUT_DIR/resources/app/out/openwork"
        ;;
    linux)
        OPENWORK_PATH="$OUTPUT_DIR/resources/app/out/openwork"
        ;;
esac

if [ -d "$OPENWORK_PATH/dist" ]; then
    print_success "✓ OpenWork files found in package"
    print_info "  Location: $OPENWORK_PATH"

    # Check for index.html
    if [ -f "$OPENWORK_PATH/dist/index.html" ]; then
        print_success "  ✓ index.html found"
    else
        print_warning "  ⚠ index.html not found"
    fi

    # Check for assets
    if [ -d "$OPENWORK_PATH/dist/assets" ]; then
        ASSET_COUNT=$(ls -1 "$OPENWORK_PATH/dist/assets" | wc -l)
        print_success "  ✓ Assets directory found ($ASSET_COUNT files)"
    else
        print_warning "  ⚠ Assets directory not found"
    fi
else
    print_error "✗ OpenWork files NOT found in package"
    print_error "  Expected location: $OPENWORK_PATH"
    exit 1
fi

echo ""
print_success "=== Build Complete ==="
echo ""
print_info "Package location: $OUTPUT_DIR"

if [ "$CREATE_DMG" = true ] && [ "$PLATFORM" = "darwin" ]; then
    print_info "DMG location: $DMG_OUT_DIR/VSCode-darwin-$ARCH.dmg"
fi

echo ""

# Print test instructions
print_info "To test OpenWork integration:"
echo ""

case "$PLATFORM" in
    darwin)
        echo "  cd \"$OUTPUT_DIR\""
        echo "  ./Code\\ -\\ OSS.app/Contents/MacOS/Electron --openwork"
        echo ""
        echo "Or use the code command:"
        echo "  ./Code\\ -\\ OSS.app/Contents/Resources/app/bin/code --openwork"
        ;;
    win32)
        echo "  cd \"$OUTPUT_DIR\""
        echo "  Code.exe --openwork"
        ;;
    linux)
        echo "  cd \"$OUTPUT_DIR\""
        echo "  ./code --openwork"
        ;;
esac

echo ""
print_info "Or test via command palette:"
echo "  1. Launch VS Code (without --openwork)"
echo "  2. Press Cmd+Shift+P (macOS) or Ctrl+Shift+P (Windows/Linux)"
echo "  3. Type 'OpenWork: Open OpenWork Window' and press Enter"
echo ""

if [ "$CREATE_DMG" = true ] && [ "$PLATFORM" = "darwin" ]; then
    print_info "To install from DMG:"
    echo "  1. Open $DMG_OUT_DIR/VSCode-darwin-$ARCH.dmg"
    echo "  2. Drag 'Code - OSS' to Applications folder"
    echo "  3. Launch from Applications"
    echo ""
fi

print_success "Done!"

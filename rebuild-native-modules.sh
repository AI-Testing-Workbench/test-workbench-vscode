#!/bin/bash
# Script to rebuild native modules for AionUI
# This fixes the better-sqlite3 architecture mismatch error

set -e

echo "🔧 Rebuilding native modules for AionUI..."

cd extensions/aionui-main

# Get the Electron version from package.json
ELECTRON_VERSION=$(node -p "require('./package.json').devDependencies.electron.replace(/[~^]/, '')")
echo "📦 Electron version: $ELECTRON_VERSION"

# Check architecture
ARCH=$(uname -m)
echo "🖥️  Architecture: $ARCH"

# Rebuild using electron-builder
echo "🔨 Running electron-builder install-app-deps..."
bunx electron-builder install-app-deps

echo "✅ Native modules rebuilt successfully!"
echo ""
echo "Now you can rebuild VS Code with: ./scripts/code.sh"

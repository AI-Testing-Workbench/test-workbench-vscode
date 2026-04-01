#!/bin/bash
# Test script to verify AionUI full backend loading

echo "=== Testing AionUI Full Backend Loading ==="
echo ""

# Check if build exists
if [ ! -f "out/aionui/dist/main/index.cjs" ]; then
    echo "❌ AionUI build not found at out/aionui/dist/main/index.cjs"
    exit 1
fi

echo "✅ AionUI build found"

# Check if node_modules exists
if [ ! -d "out/aionui/node_modules" ]; then
    echo "❌ node_modules not found at out/aionui/node_modules"
    exit 1
fi

echo "✅ node_modules directory found"

# Check if @sentry/electron exists
if [ ! -d "out/aionui/node_modules/@sentry/electron" ]; then
    echo "❌ @sentry/electron not found"
    exit 1
fi

echo "✅ @sentry/electron package found"

# Count packages
PACKAGE_COUNT=$(ls -1 out/aionui/node_modules | wc -l | tr -d ' ')
echo "✅ Found $PACKAGE_COUNT packages in node_modules"

# Test loading the module
echo ""
echo "Testing module loading..."
node -e "
const path = require('path');
const aionuiPath = path.join(process.cwd(), 'out', 'aionui');
const nodeModulesPath = path.join(aionuiPath, 'node_modules');

// Set NODE_PATH
process.env.NODE_PATH = nodeModulesPath;
require('module').Module._initPaths();

console.log('NODE_PATH set to:', process.env.NODE_PATH);

// Try to require @sentry/electron
try {
    const sentry = require('@sentry/electron/main');
    console.log('✅ Successfully loaded @sentry/electron/main');
    console.log('   Sentry.init:', typeof sentry.init);
} catch (error) {
    console.error('❌ Failed to load @sentry/electron/main:', error.message);
    process.exit(1);
}

// Try to load the AionUI module
try {
    const aionuiMain = path.join(aionuiPath, 'dist', 'main', 'index.cjs');
    const aionui = require(aionuiMain);
    console.log('✅ Successfully loaded AionUI main module');
    console.log('   Exports:', Object.keys(aionui).join(', '));
    console.log('   initializeProcess:', typeof aionui.initializeProcess);
} catch (error) {
    console.error('❌ Failed to load AionUI main module:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
}

console.log('');
console.log('🎉 All tests passed!');
"

if [ $? -eq 0 ]; then
    echo ""
    echo "=== ✅ Full Backend Test PASSED ==="
    echo ""
    echo "Next steps:"
    echo "1. Launch the packaged VS Code"
    echo "2. Open Command Palette (Cmd+Shift+P)"
    echo "3. Run 'AionUI: Open Window'"
    echo "4. Check DevTools console for backend initialization logs"
    echo ""
else
    echo ""
    echo "=== ❌ Full Backend Test FAILED ==="
    exit 1
fi

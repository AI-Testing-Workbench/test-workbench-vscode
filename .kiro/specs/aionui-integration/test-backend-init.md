# AionUI Backend Initialization Test

## Test Steps

1. **Launch Packaged VS Code**
   ```bash
   open ~/VSCode-darwin-arm64/Code\ -\ OSS.app
   ```

2. **Open AionUI Window**
   - Press `Cmd+Shift+P` to open Command Palette
   - Type "AionUI" and select "Open AionUI"
   - Wait for the window to open

3. **Check DevTools Console**
   - The AionUI window should open with DevTools already visible
   - Look for these log messages in the Console:

   **Expected Success Messages:**
   ```
   === AionUI Debug Test ===
   1. electronAPI exists: true
   2. Current path: /index.html
   3. Current hash: #/guid
   4. Testing IPC...
   5. ✅ IPC Result: {success: true, data: Array(X)}
   6. Success: true
   7. Agent count: X
   ```

   **Backend Initialization Logs (in main process):**
   - Check the main VS Code window's Help > Toggle Developer Tools
   - Look for:
     ```
     AionUIWindowManager - initializing AionUI backend system...
     AionUIWindowManager - AionUI process module loaded: {hasInitializeProcess: true, ...}
     AionUIWindowManager - calling initializeProcess()...
     AionUIWindowManager - ✅ AionUI backend initialized successfully
     ```

4. **Verify Agent Display**
   - Check if agents are displayed in the UI
   - Should see:
     - Gemini agent (built-in)
     - Any CLI-detected agents (acp, codex, etc.) if installed
     - 20 preset assistants

5. **Test IPC Communication**
   - In the AionUI DevTools Console, run:
   ```javascript
   window.electronAPI.emit('subscribe-acp.get-available-agents', {id:'test'})
     .then(r => console.log('✅ Agents:', r))
     .catch(e => console.error('❌ Error:', e));
   ```

## Expected Results

### ✅ Success Indicators
- No JavaScript errors in console
- Backend initialization log shows "✅ AionUI backend initialized successfully"
- IPC test returns `{success: true, data: [...]}`
- Agents and assistants display correctly
- No "require is not defined" errors
- No "exports is not defined" errors

### ❌ Failure Indicators
- "ReferenceError: exports is not defined" → CommonJS/ES module mismatch
- "ReferenceError: require is not defined" → Frontend trying to use Node.js require
- "Failed to initialize AionUI backend" → Backend initialization failed
- "falling back to minimal data provider" → Full backend failed, using fallback
- Empty agent list → IPC communication failed

## Troubleshooting

### If Backend Fails to Initialize

1. **Check file exists:**
   ```bash
   ls -lh ~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/dist/main/index.cjs
   ```

2. **Check VS Code logs:**
   - Open main VS Code window
   - Help > Toggle Developer Tools
   - Look for error messages starting with "AionUIWindowManager"

3. **Verify module format:**
   ```bash
   head -20 ~/VSCode-darwin-arm64/Code\ -\ OSS.app/Contents/Resources/app/out/aionui/dist/main/index.cjs
   ```
   - Should see CommonJS format: `exports.initializeProcess = ...`
   - Should NOT see ES module format: `export function initializeProcess`

### If Frontend Shows Errors

1. **Check for "require is not defined":**
   - This means frontend code is trying to use Node.js require()
   - Solution: Use ES6 import instead

2. **Check for "exports is not defined":**
   - This means backend is outputting CommonJS but VS Code expects ES modules
   - Solution: Verify Vite config outputs .cjs format

## Current Implementation Status

### ✅ Completed
- Modified Vite config to output CommonJS with .cjs extension
- Updated VS Code integration to support both .mjs and .cjs files
- Added fallback mechanism for when backend fails
- Frontend provides default data for immediate display

### 🔄 Testing
- Full backend initialization with .cjs files
- CLI detection (acp, codex, etc.)
- User configuration loading
- Extension-contributed agents

### 📋 Next Steps
1. Verify backend initializes successfully
2. Test CLI detection works
3. Test user configuration loading
4. Document any remaining issues

# AionUI IPC Bridge Fix Report

## Problem Summary

AionUI was launching successfully but the UI was not displaying data (no multi-agent icons, no skills list). The console showed storage initialization messages but no actual data was being loaded.

## Root Cause Analysis

After investigating the codebase, I discovered that:

1. **AionUI uses a sophisticated bridge system** (`@office-ai/platform`) for IPC communication
2. **The bridge requires proper initialization** - all bridge providers must be registered before the window is created
3. **Our initial approach was wrong** - we were manually handling IPC events instead of using AionUI's bridge system
4. **The bridge system has two parts**:
   - **Bridge providers** (main process) - registered via `initAllBridges()` in `process/utils/initBridge.ts`
   - **Bridge adapter** (window-specific) - registered via `initMainAdapterWithWindow(window)` in `common/adapter/main.ts`

## Solution Implemented

### 1. Import AionUI's Process Initialization

Instead of manually handling IPC events, we now import and call AionUI's `initializeProcess()` function, which:
- Initializes storage (IndexedDB/SQLite)
- Loads extensions
- Registers ALL bridge providers (conversation, fs, acpConversation, extensions, etc.)

```javascript
// Import AionUI's process initialization module
const processIndexPath = join(this.environmentService.appRoot, 'out', 'aionui', 'dist', 'process', 'index.js');

if (existsSync(processIndexPath)) {
    const { initializeProcess } = await import(processIndexPath);
    await initializeProcess();
    this.ipcHandlerRegistered = true;
}
```

### 2. Initialize Bridge Adapter for Window

After creating the BrowserWindow, we initialize the bridge adapter to connect the window to the IPC system:

```javascript
const commonAdapterPath = join(this.environmentService.appRoot, 'out', 'aionui', 'dist', 'common', 'adapter', 'main.js');

if (existsSync(commonAdapterPath)) {
    const { initMainAdapterWithWindow } = await import(commonAdapterPath);
    initMainAdapterWithWindow(aionuiWindow);
}
```

## Key Bridge Methods Used by AionUI

Based on code analysis, here are the key bridge methods that the UI relies on:

### Agent Detection
- `ipcBridge.acpConversation.getAvailableAgents.invoke()` - Returns list of available agents (Gemini, Claude, OpenCode, etc.)
- Used by: `useMultiAgentDetection.tsx`

### Skills Management
- `ipcBridge.fs.listAvailableSkills.invoke()` - Returns list of installed skills
- `ipcBridge.extensions.getSkills.invoke()` - Returns extension-contributed skills
- Used by: `SkillsHubSettings.tsx`, `useAssistantEditor.ts`

### Configuration
- `ipcBridge.config.get()` - Get configuration values
- `ipcBridge.config.getAll()` - Get all configuration

### File System
- `ipcBridge.fs.*` - Various file system operations
- Used throughout the application for file management

## Files Modified

1. `src/vs/aionui/electron-main/aionuiWindowManager.js`
   - Removed manual IPC handler registration
   - Added `initializeProcess()` call to initialize all bridges
   - Added `initMainAdapterWithWindow()` call to connect window to bridge

## Testing Status

### Build Status
✅ AionUI builds successfully
✅ VS Code compiles successfully
✅ Package created successfully
✅ AionUI files copied to correct location (`out/aionui/dist`)

### Runtime Testing Needed
⏳ Need to verify:
1. AionUI window launches
2. Bridge initialization completes without errors
3. Agents list displays correctly (multi-agent icons)
4. Skills list displays correctly
5. No console errors related to IPC/bridge

## Next Steps

1. **Manual Testing Required**:

   使用测试脚本（推荐）：
   ```bash
   ./launch-aionui-test.sh
   ```

   或直接命令行：
   ```bash
   "../VSCode-darwin-arm64/Code - OSS.app/Contents/MacOS/Code - OSS" --aionui
   ```
   ```

2. **Check DevTools Console** for:
   - Bridge initialization messages
   - Any IPC-related errors
   - Storage initialization completion
   - Agent detection results
   - Skills loading results

3. **Verify UI Elements**:
   - Multi-agent mode indicator (✨ 🔄 | 🤖 OpenCode | 💎)
   - Skills list (Morph PPT, Star Office 助手, etc.)
   - No "build.buildStorage" errors

## Technical Notes

### Why This Approach Works

1. **Complete Initialization**: `initializeProcess()` sets up the entire AionUI backend:
   - Storage layer (SQLite + IndexedDB)
   - Extension registry
   - Channel manager
   - All bridge providers

2. **Proper IPC Routing**: The bridge system uses a single IPC channel (`office-ai-bridge-adapter`) and routes events internally based on event names

3. **Window Binding**: `initMainAdapterWithWindow()` connects the specific BrowserWindow to the bridge system, enabling bidirectional communication

### Potential Issues

1. **Electron App Singleton**: AionUI's code assumes it's running as the main Electron app. Running it inside VS Code might cause conflicts with:
   - App lifecycle events
   - Protocol handlers
   - Tray icons
   - Auto-updater

2. **Path Resolution**: AionUI uses `app.getPath()` for various directories. These might not work correctly when embedded in VS Code.

3. **Database Conflicts**: If both VS Code and AionUI try to use the same database files, there could be locking issues.

## Recommendations

If the current approach doesn't work, consider:

1. **Isolated Process**: Run AionUI as a completely separate Electron process (development mode approach)
2. **Minimal Bridge**: Implement only the essential bridge methods needed for basic functionality
3. **Mock Data**: Provide mock data for agents/skills until the full bridge system is working

## References

- AionUI Bridge System: `extensions/aionui-main/src/common/adapter/`
- Bridge Initialization: `extensions/aionui-main/src/process/utils/initBridge.ts`
- Process Initialization: `extensions/aionui-main/src/process/index.ts`
- Main Entry Point: `extensions/aionui-main/src/index.ts`

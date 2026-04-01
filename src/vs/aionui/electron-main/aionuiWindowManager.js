// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

import { spawn } from 'child_process';
import { join } from 'path';

/**
 * Manages the AionUI application lifecycle
 * Launches AionUI as a separate Electron process
 */
export class AionUIWindowManager {
	// test-workbench_change: Static flag to track if IPC handler is registered globally
	// This prevents duplicate handler registration across multiple window instances
	static _globalHandlerRegistered = false;

	/**
	 * @param {any} environmentService
	 * @param {any} logService
	 */
	constructor(environmentService, logService) {
		this.environmentService = environmentService;
		this.logService = logService;
		this.aionuiProcess = null;
		this.isDevelopment = !environmentService.isBuilt;
		this.ipcHandlerRegistered = false;
		this.fallbackHandlerRegistered = false; // test-workbench_change

		this.logService.trace('AionUIWindowManager#constructor', { isDevelopment: this.isDevelopment });
	}

	/**
	 * Open or focus the AionUI application
	 * @returns {Promise<void>}
	 */
	async openWindow() {
		this.logService.trace('AionUIWindowManager#openWindow');

		// If process already exists, just log (AionUI will handle its own window management)
		if (this.aionuiProcess && !this.aionuiProcess.killed) {
			this.logService.trace('AionUIWindowManager#openWindow - AionUI process already running');
			return;
		}

		// Launch AionUI application
		await this.launchAionUI();
	}

	/**
	 * Close the AionUI application
	 */
	closeWindow() {
		this.logService.trace('AionUIWindowManager#closeWindow');

		if (this.aionuiProcess && !this.aionuiProcess.killed) {
			this.aionuiProcess.kill();
			this.aionuiProcess = null;
		}
	}

	/**
	 * Check if AionUI is currently running
	 * @returns {boolean}
	 */
	isWindowOpen() {
		return this.aionuiProcess !== null && !this.aionuiProcess.killed;
	}

	/**
	 * Launch AionUI as a separate Electron process
	 * @returns {Promise<void>}
	 */
	async launchAionUI() {
		this.logService.trace('AionUIWindowManager#launchAionUI');

		try {
			// test-workbench_change: Use in-process mode for production (more reliable)
			// Separate process mode has issues with Electron binary path on macOS
			if (this.isDevelopment) {
				this.logService.info('AionUIWindowManager#launchAionUI - launching AionUI as separate process (dev mode)');
				await this.launchAionUIAsProcess();
			} else {
				this.logService.info('AionUIWindowManager#launchAionUI - launching AionUI in-process (production mode)');
				await this.launchAionUIInProcess();
			}

		} catch (error) {
			this.logService.error('AionUIWindowManager#launchAionUI - failed to launch', error);
			throw error;
		}
	}

	/**
	 * Launch AionUI as a BrowserWindow in the same process (production mode)
	 * @returns {Promise<void>}
	 */
	async launchAionUIInProcess() {
		this.logService.info('=== launchAionUIInProcess START ===');

		// Dynamic import for ES modules
		const electron = await import('electron');
		const { BrowserWindow, protocol } = electron;
		const { existsSync } = await import('fs');

		// test-workbench_change: No need to register sentry-ipc protocol
		// Sentry is disabled in VS Code integration mode

		// Path to AionUI build output
		const aionuiDistPath = join(this.environmentService.appRoot, 'out', 'aionui', 'dist');
		const indexPath = join(aionuiDistPath, 'renderer', 'index.html');
		const preloadPath = join(aionuiDistPath, 'preload', 'index.js');

		this.logService.info('AionUIWindowManager#launchAionUIInProcess - paths:', {
			aionuiDistPath,
			indexPath,
			preloadPath,
			indexExists: existsSync(indexPath),
			preloadExists: existsSync(preloadPath)
		});

		// Verify files exist
		if (!existsSync(indexPath)) {
			const error = new Error(`AionUI index.html not found at: ${indexPath}`);
			this.logService.error('AionUIWindowManager#launchAionUIInProcess', error);
			throw error;
		}

		if (!existsSync(preloadPath)) {
			const error = new Error(`AionUI preload.js not found at: ${preloadPath}`);
			this.logService.error('AionUIWindowManager#launchAionUIInProcess', error);
			throw error;
		}

		this.logService.info('AionUIWindowManager - files verified, creating window...');

		// Initialize AionUI's complete backend system ONCE
		// This provides full functionality including ACP detection, extensions, etc.
		// test-workbench_change start
		if (!this.ipcHandlerRegistered) {
			this.logService.info('AionUIWindowManager - ========================================');
			this.logService.info('AionUIWindowManager - Initializing AionUI backend system...');
			this.logService.info('AionUIWindowManager - ========================================');

			const { ipcMain } = electron;
			const ADAPTER_BRIDGE_EVENT_KEY = 'office-ai-bridge-adapter';

			// test-workbench_change: Check if handler already exists using a more robust method
			// We'll try to initialize AionUI, and if it fails due to duplicate handlers,
			// we'll fall back to the minimal provider
			let aionuiInitialized = false;

			if (!AionUIWindowManager._globalHandlerRegistered) {
				try {
					// Path to AionUI's main process code
					const aionuiMainPath = join(this.environmentService.appRoot, 'out', 'aionui', 'dist', 'main');
					let processIndexPath = join(aionuiMainPath, 'index.mjs');
					let useCommonJS = false;

					// Check if .mjs exists, otherwise try .cjs
					if (!existsSync(processIndexPath)) {
						this.logService.info('AionUIWindowManager - index.mjs not found, trying index.cjs');
						processIndexPath = join(aionuiMainPath, 'index.cjs');
						useCommonJS = true;
						if (!existsSync(processIndexPath)) {
							this.logService.info('AionUIWindowManager - index.cjs not found, trying index.js');
							// Fallback to .js
							processIndexPath = join(aionuiMainPath, 'index.js');
							useCommonJS = true;
						}
					}

					this.logService.info('AionUIWindowManager - AionUI main process path:', {
						aionuiMainPath,
						processIndexPath,
						useCommonJS,
						exists: existsSync(processIndexPath)
					});

					if (!existsSync(processIndexPath)) {
						throw new Error(`AionUI main process not found at: ${processIndexPath}`);
					}

					// Set up NODE_PATH to include AionUI's node_modules
					// This allows AionUI's code to find its dependencies at runtime
					const aionuiNodeModules = join(this.environmentService.appRoot, 'out', 'aionui', 'node_modules');
					this.logService.info('AionUIWindowManager - Checking node_modules:', {
						aionuiNodeModules,
						exists: existsSync(aionuiNodeModules)
					});

					if (existsSync(aionuiNodeModules)) {
						const currentNodePath = process.env.NODE_PATH || '';
						process.env.NODE_PATH = currentNodePath ? `${aionuiNodeModules}:${currentNodePath}` : aionuiNodeModules;
						this.logService.info('AionUIWindowManager - Set NODE_PATH:', process.env.NODE_PATH);

						// Refresh module paths to pick up the new NODE_PATH
						// This is needed for require() to find modules in the new path
						try {
							const { createRequire } = await import('module');
							const require = createRequire(import.meta.url);
							const Module = require('module');
							if (Module._initPaths) {
								Module._initPaths();
							}
						} catch (err) {
							this.logService.warn('AionUIWindowManager - Failed to refresh module paths:', err);
						}
					} else {
						this.logService.warn('AionUIWindowManager - node_modules not found at:', aionuiNodeModules);
					}

					// Import AionUI's process initialization module
					// This will set up all the IPC handlers, ACP detection, extensions, etc.
					this.logService.info('AionUIWindowManager - Loading process module...');

					// Set environment variable to indicate VS Code integration mode
					// This disables Sentry, fix-path, and other features that may cause issues
					process.env.VSCODE_AIONUI_INTEGRATION = '1';

					// test-workbench_change: Patch require to intercept fix-path module
					// fix-path v4 is ESM-only and doesn't work correctly in CommonJS context
					// We intercept the require call to provide a compatible shim
					const { createRequire: createRequireForPatching } = await import('module');
					const requireForPatching = createRequireForPatching(import.meta.url);

					// Save original Module._resolveFilename
					const Module = requireForPatching('module');
					const originalResolveFilename = Module._resolveFilename;

					// Patch Module._resolveFilename to intercept fix-path
					Module._resolveFilename = function(request, parent, isMain, options) {
						if (request === 'fix-path') {
							// Return a special path for our shim
							return '__fix-path-shim__';
						}
						return originalResolveFilename.call(this, request, parent, isMain, options);
					};

					// Register our shim in the module cache
					requireForPatching.cache['__fix-path-shim__'] = {
						id: '__fix-path-shim__',
						filename: '__fix-path-shim__',
						loaded: true,
						exports: function() {
							// No-op function - VS Code already handles PATH correctly
							return undefined;
						}
					};

					let processModule;
					if (useCommonJS) {
						this.logService.info('AionUIWindowManager - Using CommonJS require');
						// Use createRequire for CommonJS modules in ES module context
						const require = requireForPatching;
						processModule = require(processIndexPath);
					} else {
						this.logService.info('AionUIWindowManager - Using ES module import');
						// Use dynamic import for ES modules
						processModule = await import(processIndexPath);
					}

					this.logService.info('AionUIWindowManager - AionUI process module loaded:', {
						hasInitializeProcess: typeof processModule.initializeProcess === 'function',
						exports: Object.keys(processModule)
					});

					// Initialize AionUI's backend services
					if (typeof processModule.initializeProcess === 'function') {
						this.logService.info('AionUIWindowManager - Calling initializeProcess()...');
						await processModule.initializeProcess();
						this.logService.info('AionUIWindowManager - ✅ AionUI backend initialized successfully');
						aionuiInitialized = true;
					} else {
						this.logService.warn('AionUIWindowManager - ⚠️ initializeProcess not found, using fallback');
					}
				} catch (error) {
					this.logService.error('AionUIWindowManager - ❌ Failed to initialize AionUI backend:', error.message);

					// Check if this is a duplicate handler error
					if (error.message && error.message.includes('Attempted to register a second handler')) {
						this.logService.info('AionUIWindowManager - Handler already registered, will use existing handlers');
						aionuiInitialized = true; // Treat as success - handlers exist from previous attempt
					}
				}
			} else {
				this.logService.info('AionUIWindowManager - Backend already initialized globally, skipping');
				aionuiInitialized = true;
			}

			// If AionUI initialization failed, fall back to minimal data provider
			if (!aionuiInitialized) {
				this.logService.warn('AionUIWindowManager - Falling back to minimal data provider');
				await this.setupFallbackIpcHandler(electron);
			}

			AionUIWindowManager._globalHandlerRegistered = true;
			this.ipcHandlerRegistered = true;
		} else {
			this.logService.info('AionUIWindowManager - Backend already initialized, skipping');
		}
		// test-workbench_change end

		// Create AionUI window
		this.logService.info('AionUIWindowManager - creating BrowserWindow...');

		// test-workbench_change: Use the default session to access vscode-file:// protocol
		const { session } = electron;

		const aionuiWindow = new BrowserWindow({
			width: 1200,
			height: 800,
			title: 'AionUI',
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				preload: preloadPath,
				webSecurity: false, // test-workbench_change: Disable web security to allow loading local resources
				allowRunningInsecureContent: false,
				sandbox: false,
				webviewTag: true, // Enable webview tag for HTML preview
				session: session.defaultSession // test-workbench_change: Use default session to access vscode-file protocol
			}
		});
		this.logService.info('AionUIWindowManager - BrowserWindow created, id:', aionuiWindow.id);

		// Always enable DevTools for debugging
		// This helps identify issues when running in production mode
		aionuiWindow.webContents.openDevTools();
		this.logService.info('AionUIWindowManager - DevTools opened for debugging');

		// Inject debug script to test IPC communication
		// test-workbench_change start
		aionuiWindow.webContents.on('did-finish-load', () => {
			const debugScript = `
				(function() {
					console.log('=== AionUI Debug Test ===');
					console.log('1. electronAPI exists:', !!window.electronAPI);
					console.log('2. Current path:', window.location.pathname);
					console.log('3. Current hash:', window.location.hash);

					if (window.electronAPI) {
						console.log('4. Testing IPC...');
						window.electronAPI.emit('subscribe-acp.get-available-agents', { id: 'debug-test-' + Date.now() })
							.then(result => {
								console.log('5. ✅ IPC Result:', result);
								console.log('5a. Result type:', typeof result);
								console.log('5b. Result keys:', result ? Object.keys(result) : 'null');
								console.log('5c. Result JSON:', JSON.stringify(result));
								console.log('6. Success:', result?.success);
								console.log('7. Agent count:', result?.data?.length);
								if (result?.data) {
									result.data.forEach((agent, i) => {
										console.log('   Agent ' + i + ':', JSON.stringify(agent));
										// Check filter condition
										const isGeminiWithCli = agent.backend === 'gemini' && agent.cliPath;
										const passesFilter = !isGeminiWithCli;
										console.log('   - isGeminiWithCli:', isGeminiWithCli, ', passesFilter:', passesFilter);
									});
								}
							})
							.catch(error => {
								console.error('5. ❌ IPC Error:', error);
							});
					} else {
						console.error('4. ❌ electronAPI not found!');
					}

					// Check UI elements and React state
					setTimeout(() => {
						console.log('8. Checking UI elements...');
						const agentPills = document.querySelectorAll('[data-agent-pill="true"]');
						const agentCards = document.querySelectorAll('[class*="agent" i]');
						const cards = document.querySelectorAll('[class*="card" i]');
						const buttons = document.querySelectorAll('button');
						console.log('   Agent pills (data-agent-pill):', agentPills.length);
						console.log('   Agent elements (class*=agent):', agentCards.length);
						console.log('   Card elements:', cards.length);
						console.log('   Button elements:', buttons.length);

						console.log('9. Agent pills details:');
						Array.from(agentPills).forEach((pill, i) => {
							const backend = pill.getAttribute('data-agent-backend');
							const key = pill.getAttribute('data-agent-key');
							const selected = pill.getAttribute('data-agent-selected');
							console.log('   Pill ' + i + ': backend=' + backend + ', key=' + key + ', selected=' + selected);
						});

						// Try to access React internals to see the actual state
						console.log('10. Checking for React root...');
						const root = document.getElementById('root');
						if (root) {
							const reactRoot = root._reactRootContainer || root._reactRootContainer || Object.keys(root).find(key => key.startsWith('__react'));
							console.log('   React root found:', !!reactRoot);
						}

						console.log('11. Page title:', document.title);
					}, 3000);
				})();
			`;

			aionuiWindow.webContents.executeJavaScript(debugScript).catch((error) => {
				this.logService.error('AionUIWindowManager - Failed to inject debug script:', error);
			});
		});
		// test-workbench_change end

		// Handle load errors
		aionuiWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
			this.logService.error('AionUIWindowManager#launchAionUIInProcess - failed to load', {
				errorCode,
				errorDescription,
				validatedURL
			});
		});

		// Handle console messages - log all levels to main process
		aionuiWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
			const levelMap = { 0: 'log', 1: 'warn', 2: 'error' };
			const levelName = levelMap[level] || 'log';

			// Log to main process with appropriate level
			if (level === 2) {
				this.logService.error(`AionUI Console [${levelName}]:`, { message, line, sourceId });
			} else if (level === 1) {
				this.logService.warn(`AionUI Console [${levelName}]:`, { message, line, sourceId });
			} else {
				this.logService.info(`AionUI Console [${levelName}]:`, { message, line, sourceId });
			}
		});

		// Load AionUI using vscode-file:// protocol (VS Code blocks file:// protocol)
		try {
			// Convert file path to vscode-file:// URL
			// VS Code uses vscode-file:// protocol for loading local resources
			// Format: vscode-file://vscode-app/absolute/path/to/file
			const vscodeFileUrl = `vscode-file://vscode-app${indexPath}`;
			this.logService.info('AionUIWindowManager#launchAionUIInProcess - loading URL', { vscodeFileUrl });

			await aionuiWindow.loadURL(vscodeFileUrl);

			this.logService.info('AionUIWindowManager#launchAionUIInProcess - successfully loaded index.html');

			// Check if window is still alive after loading
			if (aionuiWindow.isDestroyed()) {
				this.logService.error('AionUIWindowManager#launchAionUIInProcess - window was destroyed after loadURL');
				throw new Error('Window was destroyed after loading');
			}

			this.logService.info('AionUIWindowManager#launchAionUIInProcess - window is still alive after loading');

		} catch (error) {
			this.logService.error('AionUIWindowManager#launchAionUIInProcess - loadURL failed', error);
			throw error;
		}

		// Store reference
		this.aionuiProcess = { killed: false, window: aionuiWindow };

		// Handle window close
		aionuiWindow.on('closed', () => {
			this.logService.info('AionUIWindowManager - window closed event');
			this.aionuiProcess = null;
		});

		// Add more event handlers to debug window lifecycle
		aionuiWindow.on('close', (event) => {
			this.logService.info('AionUIWindowManager - window close event (before closing)');
		});

		aionuiWindow.on('hide', () => {
			this.logService.info('AionUIWindowManager - window hide event');
		});

		aionuiWindow.on('show', () => {
			this.logService.info('AionUIWindowManager - window show event');
		});

		aionuiWindow.on('blur', () => {
			this.logService.trace('AionUIWindowManager - window blur event');
		});

		aionuiWindow.on('focus', () => {
			this.logService.trace('AionUIWindowManager - window focus event');
		});

		this.logService.info('AionUIWindowManager#launchAionUIInProcess - AionUI window created successfully');
	}

	/**
	 * Launch AionUI as a separate Electron process (works in both dev and production)
	 * @returns {Promise<void>}
	 */
	async launchAionUIAsProcess() {
		// test-workbench_change: Support both development and production modes

		this.logService.info('=== launchAionUIAsProcess START ===');

		// In production, use the packaged AionUI from out/aionui
		// In development, use the source from extensions/aionui-main
		const isProduction = !this.isDevelopment;

		this.logService.info('Mode check:', { isProduction, isDevelopment: this.isDevelopment });

		let aionuiPath, electronPath, aionuiMain;

		if (isProduction) {
			// Production: use packaged AionUI
			aionuiPath = join(this.environmentService.appRoot, 'out', 'aionui');

			// Use the Electron binary from the app bundle
			// On macOS: Code - OSS.app/Contents/MacOS/Code - OSS
			// The appRoot is: Code - OSS.app/Contents/Resources/app
			const appRoot = this.environmentService.appRoot;

			// Get the actual Electron executable path
			// On macOS, we need the path to the Electron Framework, not the wrapper
			const { existsSync } = await import('fs');
			const process = await import('process');

			// Use process.execPath which points to the actual Electron binary
			electronPath = process.execPath;

			this.logService.info('Using Electron from process.execPath:', electronPath);

			// Main entry point
			aionuiMain = join(aionuiPath, 'dist', 'main', 'index.cjs');

			this.logService.info('AionUIWindowManager#launchAionUIAsProcess - production mode', {
				aionuiPath,
				electronPath,
				aionuiMain,
				appRoot,
				electronExists: existsSync(electronPath),
				mainExists: existsSync(aionuiMain)
			});
		} else {
			// Development: use source AionUI
			aionuiPath = join(this.environmentService.appRoot, 'extensions', 'aionui-main');
			electronPath = join(aionuiPath, 'node_modules', '.bin', 'electron');
			aionuiMain = join(aionuiPath, 'out', 'main', 'index.js');

			this.logService.info('AionUIWindowManager#launchAionUIAsProcess - development mode', {
				aionuiPath,
				electronPath,
				aionuiMain
			});
		}

		this.logService.info('About to spawn process...');

		// Spawn AionUI as a separate process
		this.aionuiProcess = spawn(electronPath, [aionuiMain], {
			cwd: aionuiPath,
			detached: false,
			stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr
			env: {
				...process.env,
				// Set NODE_PATH for production mode
				...(isProduction ? { NODE_PATH: join(aionuiPath, 'node_modules') } : {}),
				// Disable single instance lock when launched from VS Code
				AIONUI_E2E_TEST: '1',
				// Enable debug logging
				DEBUG: '*'
			}
		});

		this.logService.info('Process spawned, PID:', this.aionuiProcess.pid);

		// Write logs to file for debugging
		const os = await import('os');
		const fs = await import('fs');
		const logPath = join(os.tmpdir(), 'aionui-vscode.log');

		// Clear previous log file
		try {
			fs.writeFileSync(logPath, `=== AionUI Launch Log (${new Date().toISOString()}) ===\n`);
		} catch (err) {
			this.logService.warn('Failed to clear log file:', err);
		}

		const logStream = fs.createWriteStream(logPath, { flags: 'a' });
		this.logService.info(`AionUI logs will be written to: ${logPath}`);

		// Log spawn details
		logStream.write(`[spawn] electronPath: ${electronPath}\n`);
		logStream.write(`[spawn] aionuiMain: ${aionuiMain}\n`);
		logStream.write(`[spawn] cwd: ${aionuiPath}\n`);
		logStream.write(`[spawn] AIONUI_E2E_TEST: ${process.env.AIONUI_E2E_TEST}\n`);
		logStream.write(`[spawn] PID: ${this.aionuiProcess.pid}\n`);

		// Capture and log stdout
		if (this.aionuiProcess.stdout) {
			this.aionuiProcess.stdout.on('data', (data) => {
				const msg = data.toString();
				this.logService.info('AionUI stdout:', msg);
				logStream.write(`[stdout] ${msg}`);
				if (!msg.endsWith('\n')) {
					logStream.write('\n');
				}
			});
		}

		// Capture and log stderr
		if (this.aionuiProcess.stderr) {
			this.aionuiProcess.stderr.on('data', (data) => {
				const msg = data.toString();
				this.logService.error('AionUI stderr:', msg);
				logStream.write(`[stderr] ${msg}`);
				if (!msg.endsWith('\n')) {
					logStream.write('\n');
				}
			});
		}

		// Handle process events
		this.aionuiProcess.on('error', (error) => {
			this.logService.error('AionUIWindowManager - process error', error);
			logStream.write(`[error] ${error.message}\n${error.stack}\n`);
			this.aionuiProcess = null;
		});

		this.aionuiProcess.on('exit', (code, signal) => {
			this.logService.info('AionUIWindowManager - process exited', { code, signal });
			logStream.write(`[exit] code=${code}, signal=${signal}\n`);
			logStream.end();
			this.aionuiProcess = null;
		});

		this.logService.info('AionUIWindowManager#launchAionUIAsProcess - AionUI launched successfully');
	}

	/**
	 * Setup fallback IPC handler when full initialization fails
	 * Provides minimal data to make the UI functional
	 * test-workbench_change start
	 * @param {any} electron - Electron module
	 * @returns {Promise<void>}
	 */
	async setupFallbackIpcHandler(electron) {
		const { ipcMain } = electron;
		const ADAPTER_BRIDGE_EVENT_KEY = 'office-ai-bridge-adapter';

		// Check if handler is already registered using both instance and static flags
		// test-workbench_change start
		if (this.fallbackHandlerRegistered || AionUIWindowManager._globalHandlerRegistered) {
			this.logService.info('AionUIWindowManager - fallback IPC handler already registered, skipping');
			return;
		}
		// test-workbench_change end

		// Create minimal data provider
		const minimalDataProvider = this.createMinimalDataProvider();

		// test-workbench_change: Wrap in try-catch to handle case where handler already exists
		try {
			// Register IPC handler for bridge events
			// This handler mimics the bridge callback pattern used by @office-ai/platform
			ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, async (_event, info) => {
				try {
					const { name, data } = JSON.parse(info);

					// Extract the ID from the data (if it exists)
					// The bridge system uses {id, ...otherData} format for subscribe requests
					const requestId = data?.id;

					this.logService.info(`FallbackHandler - handling event: ${name}`, requestId ? `id=${requestId}` : 'no id');

					// Handle the event with minimal data provider
					const result = await minimalDataProvider.handleEvent(name, data);

					// Log the response (truncated for readability)
					const resultStr = JSON.stringify(result);
					this.logService.info(`FallbackHandler - response for ${name}:`, resultStr.length > 200 ? resultStr.substring(0, 200) + '...' : resultStr);

					// Return the result directly
					// The IPC handler should return the actual data, not a callback event
					return result;
				} catch (error) {
					this.logService.error('AionUIWindowManager - fallback bridge error:', error);
					// Return a proper error response instead of rejecting
					return { success: false, error: error.message };
				}
			});

			this.fallbackHandlerRegistered = true;
			AionUIWindowManager._globalHandlerRegistered = true; // test-workbench_change
			this.logService.info('AionUIWindowManager - ========================================');
			this.logService.info('AionUIWindowManager - fallback IPC handler registered');
			this.logService.info('AionUIWindowManager - ========================================');
		} catch (error) {
			if (error.message && error.message.includes('Attempted to register a second handler')) {
				this.logService.info('AionUIWindowManager - IPC handler already exists (registered by AionUI), skipping fallback');
				this.fallbackHandlerRegistered = true;
				AionUIWindowManager._globalHandlerRegistered = true;
			} else {
				throw error;
			}
		}
	}

	/**
	 * Create minimal data provider for AionUI
	 * Provides basic data to make the UI functional without full bridge system
	 * @returns {Object} Data provider with handleEvent method
	 */
	createMinimalDataProvider() {
		const logService = this.logService;

		return {
			/**
			 * Handle bridge events
			 * @param {string} name - Event name
			 * @param {any} data - Event data
			 * @returns {Promise<any>} Event result
			 */
			async handleEvent(name, data) {
				// Extract request ID if present (used for logging)
				const requestId = data?.id;
				const logPrefix = `MinimalDataProvider [${requestId || 'no-id'}]`;

				logService.info(`${logPrefix} - handling: ${name}`);

				// Handle storage get requests
				if (name.startsWith('subscribe-') && name.includes('.storage.get')) {
					const key = data?.key;
					logService.info(`${logPrefix} - storage.get: ${key}`);
					return { value: null };
				}

				// Handle extensions.get-skills
				if (name === 'subscribe-extensions.get-skills') {
					logService.info(`${logPrefix} - returning empty skills`);
					return [];
				}

				// Handle extensions.get-agents
				if (name === 'subscribe-extensions.get-agents') {
					logService.info(`${logPrefix} - returning empty agents`);
					return [];
				}

				// Handle extensions.get-assistants
				if (name === 'subscribe-extensions.get-assistants') {
					logService.info(`${logPrefix} - returning empty assistants`);
					return [];
				}

				// Handle extensions.get-themes
				if (name === 'subscribe-extensions.get-themes') {
					logService.info(`${logPrefix} - returning empty themes`);
					return [];
				}

				// Handle extensions.get-loaded-extensions
				if (name === 'subscribe-extensions.get-loaded-extensions') {
					logService.info(`${logPrefix} - returning empty extensions`);
					return [];
				}

				// Handle acp.get-available-agents
				// This is the CRITICAL endpoint - UI needs this to show available agents
				if (name === 'subscribe-acp.get-available-agents') {
					const response = {
						success: true,
						data: [
							{
								backend: 'gemini',
								name: 'Gemini',
								// Important: Do NOT set cliPath for built-in Gemini
								// The UI filters out agents with cliPath set
								supportedTransports: [] // Empty transport list
							}
						]
					};
					logService.info(`${logPrefix} - ✅ returning Gemini agent:`, JSON.stringify(response));
					return response;
				}

				// Handle remote-agent.list
				if (name === 'subscribe-remote-agent.list') {
					logService.info(`${logPrefix} - returning empty remote agents`);
					return [];
				}

				// Handle model-related requests
				if (name.includes('model')) {
					logService.info(`${logPrefix} - model request, returning empty`);
					return [];
				}

				// Handle conversation-related requests
				if (name.includes('conversation')) {
					logService.info(`${logPrefix} - conversation request, returning success`);
					return { success: true };
				}

				// Handle cron-related requests
				if (name.includes('cron')) {
					logService.info(`${logPrefix} - cron request, returning empty`);
					return [];
				}

				// Handle google.auth.status
				if (name === 'subscribe-google.auth.status') {
					logService.info(`${logPrefix} - returning Google auth status (authenticated)`);
					return { authenticated: true };
				}

				// Default response for unknown events
				logService.info(`${logPrefix} - unknown event, returning success`);
				return { success: true };
			}
		};
	}
	// test-workbench_change end

	/**
	 * Dispose resources
	 */
	dispose() {
		this.closeWindow();
	}
}

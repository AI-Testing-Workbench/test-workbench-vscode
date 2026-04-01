// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

import { join } from 'path';

/**
 * Manages the OpenWork application lifecycle
 * Launches OpenWork Web app in an Electron BrowserWindow
 */
export class OpenWorkWindowManager {
	/**
	 * @param {any} environmentService
	 * @param {any} logService
	 */
	constructor(environmentService, logService) {
		this.environmentService = environmentService;
		this.logService = logService;
		this.openworkWindow = null;
		this.isDevelopment = !environmentService.isBuilt;

		this.logService.trace('OpenWorkWindowManager#constructor', { isDevelopment: this.isDevelopment });
	}

	/**
	 * Open or focus the OpenWork window
	 * @returns {Promise<void>}
	 */
	async openWindow() {
		this.logService.trace('OpenWorkWindowManager#openWindow');

		// If window already exists and is not destroyed, focus it
		if (this.openworkWindow && !this.openworkWindow.isDestroyed()) {
			this.logService.trace('OpenWorkWindowManager#openWindow - focusing existing window');
			this.openworkWindow.focus();
			return;
		}

		// Create new window
		await this.createWindow();
	}

	/**
	 * Close the OpenWork window
	 */
	closeWindow() {
		this.logService.trace('OpenWorkWindowManager#closeWindow');

		if (this.openworkWindow && !this.openworkWindow.isDestroyed()) {
			this.openworkWindow.close();
			this.openworkWindow = null;
		}
	}

	/**
	 * Check if OpenWork window is currently open
	 * @returns {boolean}
	 */
	isWindowOpen() {
		return this.openworkWindow !== null && !this.openworkWindow.isDestroyed();
	}

	/**
	 * Get the OpenWork window instance
	 * @returns {any}
	 */
	getWindow() {
		return this.openworkWindow;
	}

	/**
	 * Create the OpenWork BrowserWindow
	 * @returns {Promise<void>}
	 */
	async createWindow() {
		this.logService.info('OpenWorkWindowManager#createWindow - creating OpenWork window');

		try {
			// Dynamic import for ES modules
			const electron = await import('electron');
			const { BrowserWindow } = electron;
			const { existsSync } = await import('fs');

			// Determine the URL to load
			const loadUrl = await this.getLoadUrl();
			this.logService.info('OpenWorkWindowManager#createWindow - load URL', { loadUrl });

			// Get icon path
			const iconPath = this.getIconPath();
			const iconExists = existsSync(iconPath);
			this.logService.info('OpenWorkWindowManager#createWindow - icon', { iconPath, iconExists });

			// Create BrowserWindow
			this.openworkWindow = new BrowserWindow({
				width: 1400,
				height: 900,
				minWidth: 1024,
				minHeight: 768,
				title: 'OpenWork - Collaborative Workspace',
				icon: iconExists ? iconPath : undefined,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
					webSecurity: true,
					allowRunningInsecureContent: false,
					sandbox: false
				}
			});

			// Open DevTools in development mode
			if (this.isDevelopment) {
				this.openworkWindow.webContents.openDevTools();
				this.logService.info('OpenWorkWindowManager#createWindow - DevTools opened');
			}

			// Handle load errors
			this.openworkWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
				this.logService.error('OpenWorkWindowManager#createWindow - failed to load', {
					errorCode,
					errorDescription,
					validatedURL
				});
			});

			// Handle console messages
			this.openworkWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
				const levelMap = { 0: 'log', 1: 'warn', 2: 'error' };
				const levelName = levelMap[level] || 'log';

				if (level === 2) {
					this.logService.error(`OpenWork Console [${levelName}]:`, { message, line, sourceId });
				} else if (level === 1) {
					this.logService.warn(`OpenWork Console [${levelName}]:`, { message, line, sourceId });
				} else {
					this.logService.trace(`OpenWork Console [${levelName}]:`, { message, line, sourceId });
				}
			});

			// Load the URL
			await this.openworkWindow.loadURL(loadUrl);
			this.logService.info('OpenWorkWindowManager#createWindow - successfully loaded');

			// Handle window close
			this.openworkWindow.on('closed', () => {
				this.logService.trace('OpenWorkWindowManager - window closed');
				this.openworkWindow = null;
			});

			// Show the window
			this.openworkWindow.show();

		} catch (error) {
			this.logService.error('OpenWorkWindowManager#createWindow - failed to create window', error);
			throw error;
		}
	}

	/**
	 * Get the URL to load (dev server or built files)
	 * @returns {Promise<string>}
	 */
	async getLoadUrl() {
		if (this.isDevelopment) {
			// Development mode: try to connect to Vite dev server
			const devServerUrl = 'http://localhost:5173';
			const isAvailable = await this.checkDevServer(devServerUrl);

			if (isAvailable) {
				this.logService.info('OpenWorkWindowManager#getLoadUrl - using dev server', { devServerUrl });
				return devServerUrl;
			} else {
				this.logService.warn('OpenWorkWindowManager#getLoadUrl - dev server not running, falling back to built files');
			}
		}

		// Production mode: load built files using vscode-file:// protocol
		// VS Code uses vscode-file:// protocol for loading local resources (file:// is blocked)
		const distPath = join(this.environmentService.appRoot, 'out', 'openwork', 'dist', 'index.html');
		const vscodeFileUrl = `vscode-file://vscode-app${distPath}`;
		this.logService.info('OpenWorkWindowManager#getLoadUrl - using built files', { vscodeFileUrl });
		return vscodeFileUrl;
	}

	/**
	 * Check if dev server is available
	 * @param {string} url
	 * @returns {Promise<boolean>}
	 */
	async checkDevServer(url) {
		try {
			const response = await fetch(url, { method: 'HEAD' });
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Get the icon path
	 * @returns {string}
	 */
	getIconPath() {
		return join(
			this.environmentService.appRoot,
			'extensions',
			'openwork-dev',
			'openwork-logo-transparent.svg'
		);
	}

	/**
	 * Dispose resources
	 */
	dispose() {
		this.closeWindow();
	}
}

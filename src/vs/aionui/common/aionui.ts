// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Window configuration constants for AionUI
 */
export const AionUIWindowConfig = {
	DEFAULT_WIDTH: 1200,
	DEFAULT_HEIGHT: 800,
	MIN_WIDTH: 800,
	MIN_HEIGHT: 600,
	TITLE: 'AionUI - AI Assistant',
	DEV_SERVER_URL: 'http://localhost:5173'
} as const;

/**
 * Interface for AionUI window manager
 */
export interface IAionUIWindowManager {
	/**
	 * Open or focus the AionUI window
	 */
	openWindow(): Promise<void>;

	/**
	 * Close the AionUI window
	 */
	closeWindow(): void;

	/**
	 * Check if the window is currently open
	 */
	isWindowOpen(): boolean;

	/**
	 * Get the window instance
	 */
	getWindow(): Electron.BrowserWindow | null;
}

/**
 * AionUI window options
 */
export interface IAionUIWindowOptions {
	/**
	 * Whether to open DevTools automatically
	 */
	openDevTools?: boolean;

	/**
	 * Custom URL to load (overrides default)
	 */
	url?: string;
}

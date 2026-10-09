/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file
// Preload for the desktop pet window. Runs sandboxed with context isolation;
// only a small whitelist of IPC channels is bridged to the page.
// Written like VS Code's own sandboxed preloads (IIFE + require) and compiled
// to .js by the client build.

/* eslint-disable no-restricted-globals */

(function () {

	const { ipcRenderer, contextBridge } = require('electron');

	const ALLOWED_SEND = new Set<string>([
		'desktopPet:drag-start',
		'desktopPet:drag-move',
		'desktopPet:drag-end'
	]);

	const ALLOWED_ON = new Set<string>([]);

	contextBridge.exposeInMainWorld('desktopPetIpc', {
		isMacintosh: process.platform === 'darwin',
		send(channel: string, ...args: unknown[]) {
			if (ALLOWED_SEND.has(channel)) {
				ipcRenderer.send(channel, ...args);
			}
		},
		on(channel: string, listener: (...args: unknown[]) => void) {
			if (ALLOWED_ON.has(channel)) {
				ipcRenderer.on(channel, (_event: unknown, ...args: unknown[]) => listener(...args));
			}
		}
	});
})();

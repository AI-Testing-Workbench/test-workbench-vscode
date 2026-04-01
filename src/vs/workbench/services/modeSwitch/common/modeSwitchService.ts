// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IModeSwitchService = createDecorator<IModeSwitchService>('modeSwitchService');

export enum WorkbenchMode {
	IDE = 'ide',
	Partner = 'partner'
}

export interface IModeSwitchService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when the mode changes
	 */
	readonly onDidChangeMode: Event<WorkbenchMode>;

	/**
	 * Get the current workbench mode
	 */
	readonly currentMode: WorkbenchMode;

	/**
	 * Toggle between IDE and Partner modes
	 */
	toggleMode(): void;

	/**
	 * Set a specific mode
	 */
	setMode(mode: WorkbenchMode): void;
}

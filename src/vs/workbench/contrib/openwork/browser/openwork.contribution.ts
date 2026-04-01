// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Action to open OpenWork window
 */
export class OpenOpenWorkWindowAction extends Action2 {
	static readonly ID = 'workbench.action.openOpenWorkWindow';
	static readonly LABEL = localize2('openOpenWorkWindow', "Open OpenWork Window");

	constructor() {
		super({
			id: OpenOpenWorkWindowAction.ID,
			title: OpenOpenWorkWindowAction.LABEL,
			category: localize2('openwork', "OpenWork"),
			f1: true // Show in command palette
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		await nativeHostService.openOpenWorkWindow();
	}
}

// Register the action
registerAction2(OpenOpenWorkWindowAction);

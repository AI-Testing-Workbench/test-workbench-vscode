// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';

/**
 * Action to open the AionUI window
 */
class OpenAionUIWindowAction extends Action2 {
	static readonly ID = 'workbench.action.openAionUIWindow';
	static readonly LABEL = localize2('openAionUIWindow', "Open AionUI Window");

	constructor() {
		super({
			id: OpenAionUIWindowAction.ID,
			title: OpenAionUIWindowAction.LABEL,
			category: localize2('aionui', "AionUI"),
			f1: true // Show in command palette
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		await nativeHostService.openAionUIWindow();
	}
}

// Register the action
registerAction2(OpenAionUIWindowAction);

// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IModeSwitchService } from '../../../services/modeSwitch/common/modeSwitchService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';

export const TOGGLE_MODE_COMMAND_ID = 'workbench.action.toggleMode';

export class ToggleModeAction extends Action2 {
	constructor() {
		super({
			id: TOGGLE_MODE_COMMAND_ID,
			title: localize2('toggleMode', 'Toggle Workbench Mode'),
			category: Categories.View,
			f1: true,
			icon: Codicon.layout, // test-workbench_change - IDE mode icon (full layout)
			toggled: {
				condition: ContextKeyExpr.equals('workbench.mode', 'partner'),
				icon: Codicon.emptyWindow // test-workbench_change - Partner mode icon (blank window)
			},
			menu: {
				id: MenuId.TitleBar,
				group: 'navigation',
				order: 1,
				when: ContextKeyExpr.true()
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const modeSwitchService = accessor.get(IModeSwitchService);
		modeSwitchService.toggleMode();
	}
}

registerAction2(ToggleModeAction);

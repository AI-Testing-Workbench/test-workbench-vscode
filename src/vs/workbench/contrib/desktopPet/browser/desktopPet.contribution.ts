/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file
// Workbench-side entry for the desktop pet. The pet itself is owned by the
// main process (see vs/platform/desktopPet); this only exposes the toggle
// command that talks to it via the native host service.

import * as nls from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'desktopPet.toggle',
			title: nls.localize2('desktopPet.toggle', "Show or Hide Desktop Pet"),
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(INativeHostService).toggleDesktopPet();
	}
});

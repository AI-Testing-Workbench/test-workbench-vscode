/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
// The Agents window reuses the shared Source Control and Extensions view containers, but hosts
// them in its own auxiliary bar instead of the editor window's Activity Bar sidebar. The shared
// containers are registered at `ViewContainerLocation.Sidebar` with `WindowEnablement.Both`; here
// we relocate them into the auxiliary bar for this window only. The relocation is deliberately not
// persisted so it never leaks into the editor window, which shares the same profile storage.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../../workbench/common/views.js';
import { VIEWLET_ID as EXTENSIONS_VIEWLET_ID } from '../../../../workbench/contrib/extensions/common/extensions.js';
import { VIEWLET_ID as SCM_VIEWLET_ID } from '../../../../workbench/contrib/scm/common/scm.js';

// Containers relocated from the editor window's sidebar into the Agents window auxiliary bar.
const RELOCATED_TOOL_CONTAINER_IDS: readonly string[] = [
	SCM_VIEWLET_ID,
	EXTENSIONS_VIEWLET_ID,
];

class AuxiliaryBarToolViewsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessions.auxiliaryBarToolViews';

	constructor(
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		super();

		for (const containerId of RELOCATED_TOOL_CONTAINER_IDS) {
			const container = viewDescriptorService.getViewContainerById(containerId);
			if (!container) {
				continue;
			}
			if (viewDescriptorService.getViewContainerLocation(container) === ViewContainerLocation.AuxiliaryBar) {
				continue;
			}
			viewDescriptorService.moveViewContainerToLocationForWindow(container, ViewContainerLocation.AuxiliaryBar, AuxiliaryBarToolViewsContribution.ID);
		}
	}
}

registerWorkbenchContribution2(AuxiliaryBarToolViewsContribution.ID, AuxiliaryBarToolViewsContribution, WorkbenchPhase.BlockStartup);

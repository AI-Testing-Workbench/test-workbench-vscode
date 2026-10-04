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
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { Extensions as ViewExtensions, ICustomViewDescriptor, IViewDescriptorService, IViewContainersRegistry, IViewsRegistry, ViewContainer, ViewContainerLocation, WindowEnablement } from '../../../../workbench/common/views.js';
import { VIEWLET_ID as EXTENSIONS_VIEWLET_ID } from '../../../../workbench/contrib/extensions/common/extensions.js';
import { VIEWLET_ID as SCM_VIEWLET_ID } from '../../../../workbench/contrib/scm/common/scm.js';

// Containers relocated from the editor window's sidebar into the Agents window auxiliary bar.
const RELOCATED_TOOL_CONTAINER_IDS: readonly string[] = [
	SCM_VIEWLET_ID,
	EXTENSIONS_VIEWLET_ID,
];

const isSessionsAllowed = (enablement: WindowEnablement | undefined): boolean =>
	enablement === WindowEnablement.Sessions || enablement === WindowEnablement.Both; // test-workbench_change

class AuxiliaryBarToolViewsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessions.auxiliaryBarToolViews';

	constructor(
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		super();

		const relocate = (container: ViewContainer): void => {
			if (viewDescriptorService.getViewContainerLocation(container) === ViewContainerLocation.AuxiliaryBar) {
				return;
			}
			viewDescriptorService.moveViewContainerToLocationForWindow(container, ViewContainerLocation.AuxiliaryBar, AuxiliaryBarToolViewsContribution.ID);
		};

		for (const containerId of RELOCATED_TOOL_CONTAINER_IDS) {
			const container = viewDescriptorService.getViewContainerById(containerId);
			if (container) {
				relocate(container);
			}
		}

		// test-workbench_change start — surface extension UI in the auxiliary bar tool strip:
		//  - containers contributed by an extension (allowed here via `WindowEnablement.Both`);
		//  - built-in containers that only carry views allowed in this window because an extension
		//    added its view to them (e.g. an extension view in Explorer).
		// Both register dynamically, so relocate existing ones and listen for later registrations.
		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		const hasExtensionViewAllowedHere = (container: ViewContainer): boolean =>
			(container.extensionId !== undefined && isSessionsAllowed(container.windowEnablement))
			|| viewsRegistry.getViews(container).some(view => !!(view as ICustomViewDescriptor).extensionId && isSessionsAllowed(view.windowEnablement));
		const relocateToolContainer = (container: ViewContainer): void => {
			if (viewDescriptorService.getViewContainerLocation(container) !== ViewContainerLocation.Sidebar) {
				return;
			}
			if (hasExtensionViewAllowedHere(container)) {
				relocate(container);
			}
		};
		const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		for (const container of viewContainersRegistry.all) {
			relocateToolContainer(container);
		}
		this._register(viewContainersRegistry.onDidRegister(({ viewContainer }) => relocateToolContainer(viewContainer)));
		this._register(viewsRegistry.onViewsRegistered(entries => entries.forEach(({ viewContainer }) => relocateToolContainer(viewContainer))));
		// test-workbench_change end
	}
}

registerWorkbenchContribution2(AuxiliaryBarToolViewsContribution.ID, AuxiliaryBarToolViewsContribution, WorkbenchPhase.BlockStartup);

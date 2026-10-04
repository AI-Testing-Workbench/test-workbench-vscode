/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { editorBackground } from '../../../platform/theme/common/colorRegistry.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { AbstractPaneCompositePart, CompositeBarPosition } from '../../../workbench/browser/parts/paneCompositePart.js';
import { IPaneCompositeBarOptions } from '../../../workbench/browser/parts/paneCompositeBar.js';
import { Parts } from '../../../workbench/services/layout/browser/layoutService.js';
import { Extensions as ViewExtensions, ICustomViewDescriptor, IViewContainersRegistry, IViewsRegistry, ViewContainer, WindowEnablement } from '../../../workbench/common/views.js';
import { SESSIONS_FILES_TOOL_CONTAINER_IDS } from '../../common/sessionToolContainers.js'; // test-workbench_change
import { AuxiliaryBarPart } from './auxiliaryBarPart.js';

/**
 * Single-pane variant of the auxiliary bar. In the single-pane layout the
 * auxiliary bar is docked inside the editor part as a contextual detail panel:
 * it has no title/composite bar, shares the editor background so the pane reads
 * as one card, and fills the exact rectangle the workbench positions it in.
 *
 * test-workbench_change: while the Files tool is active, the panel additionally shows a
 * compact, icon-only activity bar at the top (Files / Source Control / Extensions) with the
 * selected view stacked below — an Activity Bar + Primary Side Bar composition.
 */
export class SinglePaneAuxiliaryBarPart extends AuxiliaryBarPart {

	// test-workbench_change: whether the top tool activity bar is currently shown.
	private _toolBarShown = false;

	// test-workbench_change start — ids surfaced by the compact tool bar: the Files tools plus
	// extension-contributed containers (which are relocated into this auxiliary bar).
	private readonly _toolContainerIds = new Set<string>(SESSIONS_FILES_TOOL_CONTAINER_IDS);
	private _toolBarCreated = false;
	// test-workbench_change end

	override create(parent: HTMLElement): void {
		// Clear `hasTitle` so PartLayout does not reserve title height (there is no title strip).
		this.options = { ...this.options, hasTitle: false };

		// test-workbench_change start — track extension-contributed containers (and built-in
		// containers that carry an extension view allowed here) so they appear in the compact
		// activity bar and keep it visible while selected.
		const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		const isSessionsAllowed = (enablement: WindowEnablement | undefined) => enablement === WindowEnablement.Sessions || enablement === WindowEnablement.Both;
		const track = (viewContainer: ViewContainer) => {
			const hasExtensionView = viewContainer.extensionId !== undefined
				|| viewsRegistry.getViews(viewContainer).some(view => !!(view as ICustomViewDescriptor).extensionId && isSessionsAllowed(view.windowEnablement));
			if (hasExtensionView) {
				this._toolContainerIds.add(viewContainer.id);
			}
		};
		for (const viewContainer of viewContainersRegistry.all) {
			track(viewContainer);
		}
		this._register(viewContainersRegistry.onDidRegister(({ viewContainer }) => {
			track(viewContainer);
			if (this._toolBarCreated) {
				this.updateCompositeBar(true);
			}
		}));
		this._register(viewsRegistry.onViewsRegistered(entries => {
			let changed = false;
			for (const { viewContainer } of entries) {
				const before = this._toolContainerIds.size;
				track(viewContainer);
				if (this._toolContainerIds.size !== before) {
					changed = true;
				}
			}
			if (changed && this._toolBarCreated) {
				this.updateCompositeBar(true);
			}
		}));
		this._register(viewContainersRegistry.onDidDeregister(({ viewContainer }) => this._toolContainerIds.delete(viewContainer.id)));
		// test-workbench_change end

		super.create(parent);
		this._toolBarCreated = true;

		this._toolBarShown = this.shouldShowCompositeBar();

		// test-workbench_change: the top tool bar is only shown while the Files tool is active,
		// so re-evaluate (and rebuild) it when the active view container changes.
		const update = () => {
			const shouldShow = this.shouldShowCompositeBar();
			if (shouldShow !== this._toolBarShown) {
				this._toolBarShown = shouldShow;
				this.updateCompositeBar(true);
			}
		};
		this._register(this.onDidPaneCompositeOpen(update));
		this._register(this.onDidPaneCompositeClose(update));
	}

	// test-workbench_change start
	private isToolContainer(viewContainer: ViewContainer): boolean {
		return this._toolContainerIds.has(viewContainer.id);
	}
	// test-workbench_change end

	// test-workbench_change: only surface the compact bar for the Files tool containers and
	// extension-contributed containers (allowed in this window and relocated into the aux bar).
	protected override shouldShowCompositeBar(): boolean {
		const activeContainerId = this.getActivePaneComposite()?.getId();
		return activeContainerId !== undefined && this._toolContainerIds.has(activeContainerId);
	}

	// test-workbench_change: stack the bar above the content (Activity Bar on top, view below).
	protected override getCompositeBarPosition(): CompositeBarPosition {
		return CompositeBarPosition.TOP;
	}

	// test-workbench_change: icon-only bar restricted to the Files tool containers.
	protected override getCompositeBarOptions(): IPaneCompositeBarOptions {
		return {
			...super.getCompositeBarOptions(),
			icon: true,
			filterViewContainer: viewContainer => this.isToolContainer(viewContainer),
		};
	}

	protected override getPartBackgroundColor(): string {
		return this.getColor(editorBackground) || '';
	}

	override layout(width: number, height: number, top: number, left: number): void {
		if (!this.layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
			return;
		}

		// The workbench docks and sizes the aux bar to an exact rectangle (below the
		// editor tab strip); fill it directly without the card margins/border math.
		AbstractPaneCompositePart.prototype.layout.call(this, width, height, top, left);
	}
}

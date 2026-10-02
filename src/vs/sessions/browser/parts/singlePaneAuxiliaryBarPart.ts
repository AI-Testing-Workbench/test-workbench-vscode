/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { editorBackground } from '../../../platform/theme/common/colorRegistry.js';
import { AbstractPaneCompositePart, CompositeBarPosition } from '../../../workbench/browser/parts/paneCompositePart.js';
import { IPaneCompositeBarOptions } from '../../../workbench/browser/parts/paneCompositeBar.js';
import { Parts } from '../../../workbench/services/layout/browser/layoutService.js';
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

	override create(parent: HTMLElement): void {
		// Clear `hasTitle` so PartLayout does not reserve title height (there is no title strip).
		this.options = { ...this.options, hasTitle: false };
		super.create(parent);

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

	// test-workbench_change: only surface the compact bar for the Files tool containers.
	protected override shouldShowCompositeBar(): boolean {
		const activeContainerId = this.getActivePaneComposite()?.getId();
		return activeContainerId !== undefined && SESSIONS_FILES_TOOL_CONTAINER_IDS.includes(activeContainerId);
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
			filterViewContainer: viewContainer => SESSIONS_FILES_TOOL_CONTAINER_IDS.includes(viewContainer.id),
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

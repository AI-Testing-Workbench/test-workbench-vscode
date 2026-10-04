/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ViewContainerLocation, IViewDescriptorService } from '../../../../../workbench/common/views.js';
import { IPaneCompositePartService } from '../../../../../workbench/services/panecomposite/browser/panecomposite.js';
import { Parts } from '../../../../../workbench/services/layout/browser/layoutService.js';
import { IViewsService } from '../../../../../workbench/services/views/common/viewsService.js';
import { IAgentWorkbenchLayoutService } from '../../../../browser/workbench.js';
import { HasDockedDetailsContext } from '../../../../common/contextkeys.js';
import { SESSIONS_FILES_TOOL_CONTAINER_IDS } from '../../../../common/sessionToolContainers.js'; // test-workbench_change
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { CHANGES_VIEW_CONTAINER_ID } from '../../../changes/common/changes.js';
import { SESSIONS_FILES_CONTAINER_ID } from '../../../files/browser/files.contribution.js';

export const enum DetailPanelTarget {
	Hidden,
	EditorHidden,
	Changes,
	ChangesForced,
	Files,
	FilesForced,
	Preserve
}

/**
 * Shared mechanics for selecting the single-pane detail content.
 */
export class SinglePaneDetailPanelCoordinator extends Disposable {

	private readonly _hasDockedDetailsContext: IContextKey<boolean>;
	private readonly _sequencer = new Sequencer();
	private _generation = 0;
	private _target = DetailPanelTarget.Preserve;
	// test-workbench_change: remembers the last tool container picked in the Files tool's top bar,
	// so returning to the Files tool restores that selection instead of resetting to Explorer.
	private _preferredFilesToolContainerId: string | undefined;

	constructor(
		@IAgentWorkbenchLayoutService private readonly _layoutService: IAgentWorkbenchLayoutService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IPaneCompositePartService paneCompositePartService: IPaneCompositePartService,
		@ISessionsService sessionsService: ISessionsService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService, // test-workbench_change
	) {
		super();
		this._hasDockedDetailsContext = HasDockedDetailsContext.bindTo(contextKeyService);
		this._register(this._layoutService.onDidChangePartVisibility(event => {
			if (event.partId === Parts.AUXILIARYBAR_PART && event.visible) {
				this._queueTarget(this._target);
			}
		}));
		// test-workbench_change: track the top bar's last explicit selection.
		this._register(paneCompositePartService.onDidPaneCompositeOpen(({ composite, viewContainerLocation }) => {
			if (viewContainerLocation === ViewContainerLocation.AuxiliaryBar) {
				const id = composite.getId();
				// test-workbench_change — also remember extension-contributed containers.
				if (SESSIONS_FILES_TOOL_CONTAINER_IDS.includes(id) || !!this._viewDescriptorService.getViewContainerById(id)?.extensionId) {
					this._preferredFilesToolContainerId = id;
				}
			}
		}));
		this._register(autorun(reader => {
			const activeSession = sessionsService.activeSession.read(reader);
			const activeChat = activeSession?.activeChat.read(reader);
			if (!activeSession || (!(activeSession.isQuickChat?.read(reader) ?? false) && !activeChat?.workspace.read(reader))) {
				this.sync(DetailPanelTarget.Preserve);
			}
		}));
	}

	/**
	 * Publishes the target context and serializes Changes/Files container selection.
	 */
	sync(target: DetailPanelTarget): void {
		this._target = target;
		this._hasDockedDetailsContext.set(target === DetailPanelTarget.Changes || target === DetailPanelTarget.ChangesForced
			|| target === DetailPanelTarget.Files || target === DetailPanelTarget.FilesForced);
		this._queueTarget(target);
	}

	private _queueTarget(target: DetailPanelTarget): void {
		const generation = ++this._generation;
		void this._sequencer.queue(() => this._syncTarget(target, generation)).catch(onUnexpectedError);
	}

	private async _syncTarget(target: DetailPanelTarget, generation: number): Promise<void> {
		if (generation !== this._generation || !this._layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
			return;
		}

		switch (target) {
			case DetailPanelTarget.Changes:
			case DetailPanelTarget.ChangesForced:
				await this._viewsService.openViewContainer(CHANGES_VIEW_CONTAINER_ID, false);
				return;
			case DetailPanelTarget.Files:
			case DetailPanelTarget.FilesForced:
				// test-workbench_change: restore the last tool selected in the Files tool's top bar.
				await this._viewsService.openViewContainer(this._preferredFilesToolContainerId ?? SESSIONS_FILES_CONTAINER_ID, false);
				return;
			case DetailPanelTarget.Hidden:
			case DetailPanelTarget.EditorHidden:
			case DetailPanelTarget.Preserve:
				return;
		}
	}
}

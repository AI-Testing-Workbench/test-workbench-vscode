/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
// Agent window only: when the (single) editor group is empty, the stock watermark
// logo looks too bare, so replace it with a centered grid of shortcut cards that
// open the managed editor tabs. Everything here is scoped to the sessions window
// through the `.agent-sessions-workbench` root class (see the companion CSS), so
// the regular editor window keeps the stock watermark untouched.

import './media/sessionsEditorEmptyState.css';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, observableFromEvent } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { EditorGroupView } from '../../../../workbench/browser/parts/editor/editorGroupView.js';
import { IEditorGroupsService } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { IAgentWorkbenchLayoutService } from '../../../browser/workbench.js';
import { NEW_FILE_TAB_COMMAND_ID } from '../../../common/sessionCommands.js';
import { NEW_BROWSER_TAB_COMMAND_ID, NEW_CHANGES_TAB_COMMAND_ID, NEW_SEARCH_TAB_COMMAND_ID, NEW_TERMINAL_TAB_COMMAND_ID } from './addTabActions.js';

interface ISessionsEditorEmptyStateItem {
	readonly id: string;
	readonly label: string;
	readonly icon: ThemeIcon;
}

// Data-driven so more editor tools can be added here later.
const EMPTY_STATE_ITEMS: readonly ISessionsEditorEmptyStateItem[] = [
	{ id: NEW_CHANGES_TAB_COMMAND_ID, label: localize('sessionsEditorEmptyState.changes', "Changes"), icon: Codicon.gitCompare },
	{ id: NEW_FILE_TAB_COMMAND_ID, label: localize('sessionsEditorEmptyState.files', "Files"), icon: Codicon.files },
	{ id: NEW_BROWSER_TAB_COMMAND_ID, label: localize('sessionsEditorEmptyState.browser', "Browser"), icon: Codicon.globe },
	{ id: NEW_SEARCH_TAB_COMMAND_ID, label: localize('sessionsEditorEmptyState.search', "Search"), icon: Codicon.search },
	{ id: NEW_TERMINAL_TAB_COMMAND_ID, label: localize('sessionsEditorEmptyState.terminal', "Terminal"), icon: Codicon.terminal },
];

class SessionsEditorEmptyStateController extends Disposable {

	constructor(
		group: EditorGroupView,
		@ICommandService commandService: ICommandService,
	) {
		super();

		// Hosted on the group container itself; the companion CSS shows it only while
		// the container carries the `empty` class (i.e. no tab is open).
		const container = append(group.element, $('.sessions-editor-empty-state'));
		const actions = append(container, $('.sessions-editor-empty-state-actions'));

		for (const item of EMPTY_STATE_ITEMS) {
			const button = append(actions, $('button.sessions-editor-empty-state-action')) as HTMLButtonElement;
			button.type = 'button';
			button.title = item.label;
			button.setAttribute('aria-label', item.label);

			const icon = append(button, $('span.sessions-editor-empty-state-action-icon'));
			icon.classList.add(...ThemeIcon.asClassNameArray(item.icon));

			append(button, $('span.sessions-editor-empty-state-action-label')).textContent = item.label;

			this._register(addDisposableListener(button, 'click', () => void commandService.executeCommand(item.id)));
		}

		this._register(toDisposable(() => container.remove()));
	}
}

export class SessionsEditorEmptyStateContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessions.editorEmptyState';

	private readonly _controllers = this._register(new DisposableMap<EditorGroupView>());

	constructor(
		@IAgentWorkbenchLayoutService layoutService: IAgentWorkbenchLayoutService,
		@IEditorGroupsService editorGroupsService: IEditorGroupsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		// The surrounding components only exist in the single-pane redesign.
		if (!layoutService.isSinglePaneLayoutEnabled) {
			return;
		}

		const groups = observableFromEvent(
			this,
			Event.any(editorGroupsService.onDidAddGroup, editorGroupsService.onDidRemoveGroup),
			() => editorGroupsService.groups,
		);

		this._register(autorun(reader => {
			const allGroups = groups.read(reader);
			const toDelete = new Set(this._controllers.keys());

			for (const group of allGroups) {
				if (!(group instanceof EditorGroupView)) {
					continue;
				}

				toDelete.delete(group);

				if (!this._controllers.has(group)) {
					this._controllers.set(group, instantiationService.createInstance(SessionsEditorEmptyStateController, group));
				}
			}

			for (const group of toDelete) {
				this._controllers.deleteAndDispose(group);
			}
		}));
	}
}

registerWorkbenchContribution2(SessionsEditorEmptyStateContribution.ID, SessionsEditorEmptyStateContribution, WorkbenchPhase.AfterRestored);

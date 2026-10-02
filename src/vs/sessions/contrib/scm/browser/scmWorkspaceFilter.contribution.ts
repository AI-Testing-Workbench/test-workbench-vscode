/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
// The Agents window reuses the shared Source Control view, but a single window switches between
// sessions whose workspaces live in different folders. The git extension can keep repositories
// from previously visited workspaces around, which made Source Control show repositories that do
// not belong to the active session. Scope the repositories surfaced by the SCM view to the current
// (session-scoped) workspace folders by driving the view service's visibility selection.

import { isEqualOrParent } from '../../../../base/common/resources.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ISCMRepository, ISCMViewService } from '../../../../workbench/contrib/scm/common/scm.js';

class SessionsScmWorkspaceFilterContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessions.scmWorkspaceFilter';

	constructor(
		@ISCMViewService scmViewService: ISCMViewService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		super();

		const isInWorkspace = (repository: ISCMRepository): boolean => {
			const root = repository.provider.rootUri;
			if (!root) {
				return true; // Cannot scope a provider without a root
			}
			// Keep repositories that contain a workspace folder (e.g. a session opened inside a
			// repo subfolder) or that live inside one (e.g. a repo nested in a multi-root folder).
			return workspaceContextService.getWorkspace().folders.some(folder =>
				isEqualOrParent(root, folder.uri) || isEqualOrParent(folder.uri, root));
		};

		const apply = () => {
			const visible = scmViewService.repositories.filter(isInWorkspace);
			scmViewService.visibleRepositories = visible;
		};

		apply();
		this._register(scmViewService.onDidChangeRepositories(() => apply()));
		this._register(workspaceContextService.onDidChangeWorkspaceFolders(() => apply()));
	}
}

registerWorkbenchContribution2(SessionsScmWorkspaceFilterContribution.ID, SessionsScmWorkspaceFilterContribution, WorkbenchPhase.BlockStartup);

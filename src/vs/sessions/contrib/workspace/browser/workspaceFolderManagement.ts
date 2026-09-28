/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isEqualOrParent } from '../../../../base/common/resources.js'; // test-workbench_change
import { IWorkbenchContribution } from '../../../../workbench/common/contributions.js';
import { ISessionsService } from '../../../services/sessions/browser/sessionsService.js';
import { ensureSessionWorktreesTrusted } from '../../../services/sessions/browser/worktreeTrust.js';
import { testagentChatsRoot } from '../../../../platform/agentHost/common/testagentScratchDir.js'; // test-workbench_change
import { IPathService } from '../../../../workbench/services/path/common/pathService.js'; // test-workbench_change
import { IWorkspaceContextService, WorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceEditingService } from '../../../../workbench/services/workspaces/common/workspaceEditing.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { URI } from '../../../../base/common/uri.js';
import { autorun } from '../../../../base/common/observable.js';
import { IWorkspaceFolderCreationData } from '../../../../platform/workspaces/common/workspaces.js';
import { Queue } from '../../../../base/common/async.js';
import { ISessionWorkspace } from '../../../services/sessions/common/session.js';
import { IWorkspaceFolderLabelService } from '../../../../workbench/services/workspaces/common/workspaceFolderLabelService.js';

export class WorkspaceFolderManagementContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.workspaceFolderManagement';
	private queue = this._register(new Queue<void>());

	constructor(
		@ISessionsService private readonly sessionsService: ISessionsService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceFolderLabelService private readonly workspaceFolderLabelService: IWorkspaceFolderLabelService,
		@IPathService private readonly pathService: IPathService, // test-workbench_change — trust testagent scratch dirs
	) {
		super();
		this._register(autorun(reader => {
			const activeSession = this.sessionsService.activeSession.read(reader);
			const activeChat = activeSession?.activeChat.read(reader);
			const workspace = activeChat?.workspace.read(reader);
			this.queue.queue(() => this.updateWorkspaceFolders(workspace));
		}));
	}

	private async updateWorkspaceFolders(workspace: ISessionWorkspace | undefined): Promise<void> {
		// Auto-trust an isolated worktree VS Code created off a trusted repo, so a
		// worktree session mounts without tripping the untrusted-folder backstop.
		await ensureSessionWorktreesTrusted(workspace, this.workspaceTrustManagementService);
		await this.ensureTestagentScratchDirsTrusted(workspace); // test-workbench_change
		const activeSessionFolders = this.getWorkspaceFolderData(workspace);
		const currentFolders = this.workspaceContextService.getWorkspace().folders;

		// Never mount untrusted folders: mounting one would flip the whole Agents
		// Window into Restricted Mode. Sessions opened from the list are already
		// gated on trust (see `ISessionsService.canOpenSession`); this backstop
		// keeps paths that bypass that gate (e.g. startup restore) safe too.
		const mountable = await Promise.all(activeSessionFolders.map(folder => this.isFolderMountable(workspace, folder.uri)));
		if (mountable.some(isMountable => !isMountable)) {
			if (currentFolders.length > 0) {
				await this.workspaceEditingService.removeFolders(currentFolders.map(folder => folder.uri), true);
			}
			return;
		}

		if (activeSessionFolders.length === 0) {
			if (currentFolders.length > 0) {
				await this.workspaceEditingService.removeFolders(currentFolders.map(folder => folder.uri), true);
			}
			return;
		}

		if (currentFolders.length === 0) {
			await this.workspaceEditingService.addFolders(activeSessionFolders, true);
			return;
		}

		const foldersMatch = currentFolders.length === activeSessionFolders.length
			&& currentFolders.every((folder, index) => this.uriIdentityService.extUri.isEqual(folder.uri, activeSessionFolders[index].uri));
		if (foldersMatch) {
			return;
		}

		await this.workspaceEditingService.updateFolders(0, currentFolders.length, activeSessionFolders, true);
	}

	private getWorkspaceFolderData(workspace: ISessionWorkspace | undefined): IWorkspaceFolderCreationData[] {
		if (!workspace) {
			return [];
		}

		return workspace.folders.map((folder, index) => {
			const name = index === 0 ? workspace.label : folder.name;
			return {
				uri: folder.workingDirectory,
				name: this.workspaceFolderLabelService.getWorkspaceFolderLabel(
					new WorkspaceFolder({ uri: folder.workingDirectory, name, index }),
					true
				) ?? name
			};
		});
	}

	/**
	 * test-workbench_change — Auto-trust testagent's own workspace-less scratch
	 * directories (`~/.testagent/chats/<id>`) so a quick chat's editor mounts them.
	 * VS Code/the agent host created these directories, and they live outside any
	 * user project, so granting trust cannot escalate to user content. Without
	 * this the folder fails the trust gate and the editor has no root.
	 */
	private async ensureTestagentScratchDirsTrusted(workspace: ISessionWorkspace | undefined): Promise<void> {
		if (!workspace) {
			return;
		}
		const scratchRoot = testagentChatsRoot(this.pathService.userHome({ preferLocal: true }));
		const untrusted: URI[] = [];
		for (const folder of workspace.folders) {
			const uri = folder.workingDirectory;
			if (!uri || !isEqualOrParent(uri, scratchRoot)) {
				continue;
			}
			if (!(await this.workspaceTrustManagementService.getUriTrustInfo(uri)).trusted) {
				untrusted.push(uri);
			}
		}
		if (untrusted.length > 0) {
			await this.workspaceTrustManagementService.setUrisTrust(untrusted, true);
		}
	}

	/**
	 * Whether `uri` may be mounted as the workspace folder. A session that
	 * requires workspace trust may only mount a trusted folder; anything else is
	 * left unmounted so the window never enters Restricted Mode behind the user's
	 * back. Sessions that don't require trust (e.g. virtual/cloud) always mount.
	 */
	private async isFolderMountable(workspace: ISessionWorkspace | undefined, uri: URI): Promise<boolean> {
		if (!workspace?.requiresWorkspaceTrust) {
			return true;
		}
		return (await this.workspaceTrustManagementService.getUriTrustInfo(uri)).trusted;
	}
}

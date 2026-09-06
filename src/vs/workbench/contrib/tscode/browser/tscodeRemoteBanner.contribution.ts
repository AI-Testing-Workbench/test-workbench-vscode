/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - TSCode remote workspace banner (提醒用户处于远程工作区)

import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { IBannerService } from '../../../services/banner/browser/bannerService.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';
import { localize } from '../../../../nls.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

const REMOTE_SSH_AUTHORITY_PREFIX = 'ssh-remote';

/**
 * Shows a workbench banner whenever the current window is a remote-ssh
 * workspace, reminding the user to save their changes. The banner is shown on
 * every remote session (no persistence): closing it only hides it for the
 * current window.
 */
class TscodeRemoteWorkspaceBannerContribution {

	constructor(
		@IBannerService bannerService: IBannerService,
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
	) {
		const authority = environmentService.remoteAuthority;
		if (!authority || !authority.startsWith(`${REMOTE_SSH_AUTHORITY_PREFIX}+`)) {
			return; // not a remote-ssh workspace
		}

		bannerService.show({
			id: 'tscode.remote-workspace',
			icon: ThemeIcon.fromId('remote'),
			// allow-any-unicode-next-line
			message: localize('tscode.remoteWorkspace.banner', '当前为云端工作区，请注意及时将变更提交到码云仓库，避免容器销毁导致修改丢失。'),
			actions: [
				{
					// allow-any-unicode-next-line
					label: localize('tscode.remoteWorkspace.closeRemote', '关闭云端连接'),
					href: 'command:workbench.action.remote.close'
				}
			]
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(TscodeRemoteWorkspaceBannerContribution, LifecyclePhase.Restored);

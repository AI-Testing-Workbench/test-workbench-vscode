/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { getWindowId } from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { URI } from '../../../base/common/uri.js';
import { ServicesAccessor } from '../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../nls.js';
import { Action2 } from '../../../platform/actions/common/actions.js';
import { IRemoteAgentHostService } from '../../../platform/agentHost/common/remoteAgentHostService.js';
import { IAgentConnection } from '../../../platform/agentHost/common/agentService.js'; // test-workbench_change
import { IAgentHostConnectionsService } from '../../../platform/agentHost/common/agentHostConnectionsService.js'; // test-workbench_change
import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { IsAuxiliaryWindowContext } from '../../../workbench/common/contextkeys.js';
import { IsPhoneLayoutContext, SessionsWelcomeVisibleContext } from '../../common/contextkeys.js';
import { logSessionsInteraction } from '../../common/sessionsTelemetry.js';
import { Menus } from '../../browser/menus.js';
import { ISessionsService } from '../../services/sessions/browser/sessionsService.js';
import { ISessionsProvidersService } from '../../services/sessions/browser/sessionsProvidersService.js';
import { IWorkbenchContribution } from '../../../workbench/common/contributions.js';
import { OpenInVSCodeTitleBarWidget } from '../../browser/widget/openInVSCodeWidget.js';
import { IActionViewItemService } from '../../../platform/actions/browser/actionViewItemService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { resolveRemoteFolderUri } from '../../browser/openInVSCodeUtils.js';
import { INativeHostService } from '../../../platform/native/common/native.js';
import { IOpenedMainWindow } from '../../../platform/window/common/window.js';
import { OPEN_VSCODE_WINDOW_COMMAND_ID, RETURN_TO_VSCODE_EDITOR_COMMAND_ID, SHOULD_SHOW_RETURN_TO_VSCODE_EDITOR_COMMAND_ID } from '../../common/sessionCommands.js';
import { IActiveSession } from '../../services/sessions/common/sessionsManagement.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { REUSE_CURRENT_WINDOW_SETTING } from '../../common/sessionConfig.js'; // test-workbench_change

export class OpenSessionInVSCodeAction extends Action2 {
	static readonly ID = 'agents.openSessionInVSCode';

	constructor() {
		super({
			id: OpenSessionInVSCodeAction.ID,
			title: localize2('openInVSCode', 'Open in Editor'),
			icon: Codicon.vscodeInsiders,
			precondition: ContextKeyExpr.and(IsAuxiliaryWindowContext.toNegated(), SessionsWelcomeVisibleContext.toNegated()),
			menu: [{
				id: Menus.TitleBarCenterRight,
				group: 'navigation',
				order: 7,
				when: ContextKeyExpr.and(IsAuxiliaryWindowContext.toNegated(), SessionsWelcomeVisibleContext.toNegated(), IsPhoneLayoutContext.negate()),
			}]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const telemetryService = accessor.get(ITelemetryService);
		logSessionsInteraction(telemetryService, 'openInVSCode');

		const sessionsService = accessor.get(ISessionsService);
		const sessionsProvidersService = accessor.get(ISessionsProvidersService);
		const remoteAgentHostService = accessor.get(IRemoteAgentHostService);
		const nativeHostService = accessor.get(INativeHostService);
		const agentHostConnection = accessor.get(IAgentHostConnectionsService).ambientConnection; // test-workbench_change

		return openSessionInVSCode(nativeHostService, sessionsService.activeSession.get(), sessionsProvidersService, remoteAgentHostService, getReuseCurrentWindow(accessor), agentHostConnection); // test-workbench_change
	}
}

// test-workbench_change start
function getReuseCurrentWindow(accessor: ServicesAccessor): boolean {
	return accessor.get(IConfigurationService).getValue<boolean>(REUSE_CURRENT_WINDOW_SETTING) === true;
}
// test-workbench_change end

export async function openSessionInVSCode(
	nativeHostService: INativeHostService,
	session: IActiveSession | undefined,
	sessionsProvidersService: ISessionsProvidersService,
	remoteAgentHostService: IRemoteAgentHostService,
	reuseWindow = false, // test-workbench_change
	agentHostConnection?: IAgentConnection, // test-workbench_change
): Promise<void> {
	const folderUris = session?.activeChat.get().workspace.get()?.folders.map(folder =>
		resolveRemoteFolderUri(folder.workingDirectory, session.providerId, sessionsProvidersService, remoteAgentHostService)
	);
	// test-workbench_change start — hand the TestAgent backend conversation to the editor plugin.
	const testagentSession = await getTestAgentSessionToOpenInEditor(session, agentHostConnection);
	// test-workbench_change end
	if (!folderUris?.length) {
		// test-workbench_change start
		// An unsent quick chat has no projected workspace yet, but its backend
		// conversation still exists. Hand it off anyway so the editor plugin (and
		// the return trip) can focus the same session instead of a blank window.
		return reuseWindow
			? nativeHostService.openWindow({ forceReuseWindow: true, testagentSession })
			: nativeHostService.openWindow({ testagentSession });
	}
	// test-workbench_change end

	const chatSessionToOpen = getChatSessionToOpenInEditor(session);
	// test-workbench_change start
	return reuseWindow
		? nativeHostService.openWindow(folderUris.map(folderUri => ({ folderUri })), { forceReuseWindow: true, chatSessionToOpen, testagentSession })
		: nativeHostService.openWindow(folderUris.map(folderUri => ({ folderUri })), { forceNewWindow: true, chatSessionToOpen, testagentSession });
	// test-workbench_change end
}

// test-workbench_change start
/**
 * Resolve the TestAgent backend conversation for the active Agents session so
 * the editor-side plugin can focus the same conversation on handoff. The agent
 * host session resource is echoed back so a later Agents-window handoff can
 * reopen the exact session (including host-created sessions).
 *
 * A freshly created quick chat is still an `Untitled` draft (`isCreated` is
 * false) but its backend conversation and scratch directory already exist from
 * the eager create, so it must be handed off too — otherwise switching to the
 * editor and back loses the draft. Provisional `chatSessionToOpen` sharing is
 * still gated separately in {@link getChatSessionToOpenInEditor}.
 */
export async function getTestAgentSessionToOpenInEditor(session: IActiveSession | undefined, agentHostConnection: IAgentConnection | undefined): Promise<{ sessionId: string; directory?: string; agentHostResource?: string } | undefined> {
	// Non-TestAgent providers simply return no backend id from the provider method.
	if (!session || !agentHostConnection?.resolveBackendSessionId) {
		return undefined;
	}
	try {
		const backendSessionId = await agentHostConnection.resolveBackendSessionId(session.resource);
		if (!backendSessionId) {
			return undefined;
		}
		const directory = session.activeChat.get().workspace.get()?.folders[0]?.workingDirectory.fsPath;
		return { sessionId: backendSessionId, directory, agentHostResource: session.resource.toString() };
	} catch {
		return undefined;
	}
}
// test-workbench_change end

/**
 * Provisional sessions remain owned by the Agents composer and may be replaced or disposed, so only materialized sessions are safe to share across windows.
 */
export function getChatSessionToOpenInEditor(session: IActiveSession | undefined): URI | undefined {
	return session?.isCreated.get() ? session.resource : undefined;
}

export class OpenVSCodeWindowAction extends Action2 {
	static readonly ID = OPEN_VSCODE_WINDOW_COMMAND_ID;

	constructor() {
		super({
			id: OpenVSCodeWindowAction.ID,
			title: localize2('openVSCodeWindow', 'Open VS Code Window'),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);

		const windows = await nativeHostService.getWindows({ includeAuxiliaryWindows: false });
		const currentWindowId = getWindowId(mainWindow);
		const vscodeWindow = windows.find(w => w.id !== currentWindowId);

		if (vscodeWindow) {
			await nativeHostService.focusWindow({ targetWindowId: vscodeWindow.id });
		} else {
			await nativeHostService.openWindow();
		}
	}
}

export class ReturnToVSCodeEditorAction extends Action2 {

	constructor() {
		super({
			id: RETURN_TO_VSCODE_EDITOR_COMMAND_ID,
			title: localize2('returnToVSCodeEditor', 'Return to VS Code Editor'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		await returnToVSCodeEditor(nativeHostService, getWindowId(mainWindow), getReuseCurrentWindow(accessor)); // test-workbench_change
	}
}

export class ShouldShowReturnToVSCodeEditorAction extends Action2 {

	constructor() {
		super({
			id: SHOULD_SHOW_RETURN_TO_VSCODE_EDITOR_COMMAND_ID,
			title: localize2('shouldShowReturnToVSCodeEditor', 'Check Whether to Show Return to VS Code Editor'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<boolean> {
		const nativeHostService = accessor.get(INativeHostService);
		const windows = await nativeHostService.getWindows({ includeAuxiliaryWindows: false });
		return shouldShowReturnToVSCodeEditor(windows, getWindowId(mainWindow));
	}
}

export function shouldShowReturnToVSCodeEditor(windows: readonly IOpenedMainWindow[], currentWindowId: number): boolean {
	return !windows.some(window => window.id !== currentWindowId);
}

export async function returnToVSCodeEditor(nativeHostService: INativeHostService, currentWindowId: number, reuseWindow = false): Promise<void> {
	// test-workbench_change start
	if (reuseWindow) {
		// Reload the current Agents window into an empty editor window.
		await nativeHostService.openWindow({ forceReuseWindow: true });
		return;
	}
	// test-workbench_change end
	await nativeHostService.openWindow();
	await nativeHostService.closeWindow({ targetWindowId: currentWindowId });
}

export class OpenInVSCodeWidgetContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openInVSCode.widget';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(actionViewItemService.register(Menus.TitleBarCenterRight, OpenSessionInVSCodeAction.ID, (action, options) => {
			return instantiationService.createInstance(OpenInVSCodeTitleBarWidget, action, options, OpenVSCodeWindowAction.ID);
		}, undefined));
	}
}

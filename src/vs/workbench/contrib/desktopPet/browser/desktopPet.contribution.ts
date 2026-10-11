/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file
// Workbench-side entry for the desktop pet. The pet itself is owned by the
// main process (see vs/platform/desktopPet); this exposes the toggle command
// and drives the pet from TestAgent agent events.
//
// Transport (Model 1): the agent host consumes the TestAgent backend's
// `/global/event` stream and turns it into Agent Host Protocol (AHP) action
// envelopes. Observing `ambientConnection.onDidAction` here runs on the
// renderer side, so it works for local windows *and* across the remote bridge
// (the remote agent host is reached via the editor remote client) without any
// new port/tunnel of our own. States are forwarded to the local pet through
// `INativeHostService.setDesktopPetState`, which the main process ignores
// unless the user enabled "Follow TestAgent Events" on the pet's context menu.

import { Disposable } from '../../../../base/common/lifecycle.js';
import * as nls from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IAgentHostConnectionsService } from '../../../../platform/agentHost/common/agentHostConnectionsService.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'desktopPet.toggle',
			title: nls.localize2('desktopPet.toggle', "Show or Hide Desktop Pet"),
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(INativeHostService).toggleDesktopPet();
	}
});

// test-workbench_change - command the TestAgent extension (editor plugin mode)
// calls to drive the pet, since that window has no Agent Host connection of its
// own. Args travel the normal extension-command route, so this also works when
// the extension runs on a remote host.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'desktopPet.setState',
			title: nls.localize2('desktopPet.setState', "Set Desktop Pet State"),
			f1: false
		});
	}
	run(accessor: ServicesAccessor, state?: unknown): void {
		if (typeof state === 'string') {
			void accessor.get(INativeHostService).setDesktopPetState(state);
		}
	}
});

// test-workbench_change start - agent-event driven pet states
// Keep this in sync with `DesktopPetState` in vs/platform/desktopPet and with
// the `testagent-pet` backend plugin. Only three triggers are forwarded:
//   working      -> thinking.svg     (held while a turn/tool runs)
//   complete     -> attention.svg    (turn finished; then idle)
//   notification -> notification.svg (permission asked / question asked)
type DesktopPetState = 'idle' | 'working' | 'complete' | 'notification';

class DesktopPetEventContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.desktopPetEvents';

	private _working = false;
	private _inputNeeded = false;

	constructor(
		@IAgentHostConnectionsService connectionsService: IAgentHostConnectionsService,
		@INativeHostService private readonly nativeHostService: INativeHostService
	) {
		super();
		this._register(connectionsService.ambientConnection.onDidAction(envelope => {
			this._onAction(envelope.action.type);
		}));
	}

	private _onAction(type: ActionType): void {
		switch (type) {
			// 1) Working: reasoning, streaming output or a running tool.
			case ActionType.ChatTurnStarted:
			case ActionType.ChatReasoning:
			case ActionType.ChatResponsePart:
			case ActionType.ChatToolCallStart:
			case ActionType.ChatToolCallComplete:
				this._setWorking();
				break;

			// 3) Waiting for the user. `SessionInputNeededSet/Removed` is the
			// precise session-level signal (tool confirmation, question, MCP
			// auth) — unlike `ChatToolCallReady`, which fires for every tool.
			case ActionType.SessionInputNeededSet:
				this._setInputNeeded(true);
				break;
			case ActionType.SessionInputNeededRemoved:
				this._setInputNeeded(false);
				break;

			// 2) Turn finished; the pet page falls back to idle after the flash.
			case ActionType.ChatTurnComplete:
				this._inputNeeded = false;
				this._working = false;
				this._send('complete');
				break;

			// No dedicated reaction; just leave the busy pose.
			case ActionType.ChatTurnCancelled:
			case ActionType.ChatError:
				this._inputNeeded = false;
				this._working = false;
				this._send('idle');
				break;
		}
	}

	private _setWorking(): void {
		// While the agent is blocked on the user, keep showing notification.
		if (this._inputNeeded || this._working) {
			return;
		}
		this._working = true;
		this._send('working');
	}

	private _setInputNeeded(on: boolean): void {
		if (this._inputNeeded === on) {
			return;
		}
		this._inputNeeded = on;
		if (on) {
			this._send('notification');
		} else {
			this._send(this._working ? 'working' : 'idle');
		}
	}

	private _send(state: DesktopPetState): void {
		void this.nativeHostService.setDesktopPetState(state);
	}
}

registerWorkbenchContribution2(DesktopPetEventContribution.ID, DesktopPetEventContribution, WorkbenchPhase.AfterRestored);
// test-workbench_change end

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ChangesetKind } from '../common/changesetUri.js';
import type { IChangesetOperationContribution, IChangesetOperationContext, IChangesetOperationRegistry } from '../common/agentHostChangesetOperationService.js';
import { ChangesetOperationScope, ChangesetOperationStatus, type ChangesetOperation } from '../common/state/sessionState.js';
import { AgentHostDiscardChangesOperationHandler } from './agentHostDiscardChangesOperationHandler.js';
import { AgentHostStateManager, IAgentHostStateManager } from './agentHostStateManager.js';

export class AgentHostDiscardChangesOperationContribution extends Disposable implements IChangesetOperationContribution {

	// test-workbench_change start - kept so the handler can refresh git state / advertised operations after discarding all.
	private _registry: IChangesetOperationRegistry | undefined;
	// test-workbench_change end

	constructor(
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	registerHandlers(registry: IChangesetOperationRegistry): IDisposable {
		this._registry = registry;
		const store = new DisposableStore();
		const getSessionState = (sessionKey: string) => this._stateManager.getSessionState(sessionKey);
		// test-workbench_change start - pass a refresh callback for the discard-all variant.
		const handler = this._instantiationService.createInstance(
			AgentHostDiscardChangesOperationHandler,
			getSessionState,
			async (sessionKey: string) => {
				this._registry?.onDidChangeOperations(sessionKey);
				await this._registry?.refreshSessionGitState(sessionKey);
			});
		// test-workbench_change end
		store.add(registry.registerChangesetOperationHandler(AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES, handler));
		// test-workbench_change start - the changeset-scoped operation shares the handler above.
		store.add(registry.registerChangesetOperationHandler(AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_ALL_CHANGES, handler));
		store.add({ dispose: () => { this._registry = undefined; } });
		// test-workbench_change end

		return store;
	}

	getOperations({ changesetKind, gitState }: IChangesetOperationContext): ChangesetOperation[] {
		if (changesetKind !== ChangesetKind.Uncommitted || (gitState?.uncommittedChanges ?? 0) <= 0) {
			return [];
		}

		return [{
			id: AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES,
			label: localize('agentHost.changeset.discardChanges', "Discard Changes"),
			confirmation: localize('agentHost.changeset.discardChanges.confirmation', "Are you sure you want to discard the changes in \'{0}\'? This action cannot be undone."),
			icon: 'discard',
			scopes: [ChangesetOperationScope.Resource],
			status: ChangesetOperationStatus.Idle,
		} satisfies ChangesetOperation,
		// test-workbench_change start
		{
			id: AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_ALL_CHANGES,
			label: localize('agentHost.changeset.discardAllChanges', "Discard All Changes"),
			confirmation: localize('agentHost.changeset.discardAllChanges.confirmation', "Are you sure you want to discard all uncommitted changes? This action cannot be undone."),
			icon: 'discard',
			group: 'discard',
			scopes: [ChangesetOperationScope.Changeset],
			status: ChangesetOperationStatus.Idle,
		} satisfies ChangesetOperation,
		// test-workbench_change end
		];
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { InstantiationService } from '../../../instantiation/common/instantiationService.js';
import { NullLogService } from '../../../log/common/log.js';
import { buildBranchChangesetUri, buildUncommittedChangesetUri, ChangesetKind } from '../../common/changesetUri.js';
import { ChangesetOperationScope, type ISessionGitState } from '../../common/state/sessionState.js';
import { AgentHostDiscardChangesOperationHandler } from '../../node/agentHostDiscardChangesOperationHandler.js';
import { AgentHostDiscardChangesOperationContribution } from '../../node/agentHostDiscardChangesOperationProvider.js';
import { AgentHostStateManager } from '../../node/agentHostStateManager.js';

const sessionKey = 'agent:/session';
const branchChangesetUri = buildBranchChangesetUri(sessionKey);
const uncommittedChangesetUri = buildUncommittedChangesetUri(sessionKey);

const gitStateWithUncommittedChanges: ISessionGitState = {
	branchName: 'feature/test',
	uncommittedChanges: 1,
};

suite('AgentHostDiscardChangesOperationContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createContribution(): AgentHostDiscardChangesOperationContribution {
		const stateManager = disposables.add(new AgentHostStateManager(new NullLogService()));
		return disposables.add(new AgentHostDiscardChangesOperationContribution(
			stateManager,
			disposables.add(new InstantiationService()),
		));
	}

	test('advertises per-file and all-files discard on the uncommitted changeset', () => {
		const contribution = createContribution();

		const operations = contribution.getOperations({ sessionKey, changesetUri: uncommittedChangesetUri, changesetKind: ChangesetKind.Uncommitted, gitState: gitStateWithUncommittedChanges });

		assert.deepStrictEqual(operations.map(op => op.id), [
			AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES,
			AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_ALL_CHANGES,
		]);
		assert.deepStrictEqual(operations.map(op => op.scopes), [
			[ChangesetOperationScope.Resource],
			[ChangesetOperationScope.Changeset],
		]);
	});

	test('does not advertise without uncommitted changes', () => {
		const contribution = createContribution();

		const operations = contribution.getOperations({ sessionKey, changesetUri: uncommittedChangesetUri, changesetKind: ChangesetKind.Uncommitted, gitState: { ...gitStateWithUncommittedChanges, uncommittedChanges: 0 } });

		assert.deepStrictEqual(operations, []);
	});

	test('does not advertise on a non-uncommitted changeset', () => {
		const contribution = createContribution();

		const operations = contribution.getOperations({ sessionKey, changesetUri: branchChangesetUri, changesetKind: ChangesetKind.Branch, gitState: gitStateWithUncommittedChanges });

		assert.deepStrictEqual(operations, []);
	});
});

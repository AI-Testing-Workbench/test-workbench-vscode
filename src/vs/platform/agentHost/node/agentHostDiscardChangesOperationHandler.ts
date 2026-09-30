/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { basename, extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { FileSystemProviderCapabilities, IFileService } from '../../files/common/files.js';
import { ChangesetKind, parseChangesetUri } from '../common/changesetUri.js';
import { AGENT_HOST_DISCARD_ALL_CHANGES_CHANGESET_OPERATION_ID, type IChangesetOperationHandler } from '../common/agentHostChangesetOperationService.js';
import { ChangesetOperationTargetKind, type InvokeChangesetOperationParams, type InvokeChangesetOperationResult } from '../common/state/protocol/channels-changeset/commands.js';
import { AHP_SESSION_NOT_FOUND, JsonRpcErrorCodes, ProtocolError } from '../common/state/sessionProtocol.js';
import { type SessionState } from '../common/state/sessionState.js';
import { ILogService } from '../../log/common/log.js';
import { IAgentHostGitService } from '../common/agentHostGitService.js';

export class AgentHostDiscardChangesOperationHandler implements IChangesetOperationHandler {

	public static readonly OPERATION_DISCARD_CHANGES = 'discard-changes';

	// test-workbench_change start - changeset-scoped "discard every file" variant.
	public static readonly OPERATION_DISCARD_ALL_CHANGES = AGENT_HOST_DISCARD_ALL_CHANGES_CHANGESET_OPERATION_ID;
	// test-workbench_change end

	constructor(
		private readonly _getSessionState: (sessionKey: string) => SessionState | undefined,
		// test-workbench_change start - invoked after a successful discard so the host can refresh git state / operations.
		private readonly _onDiscarded: (sessionKey: string) => Promise<void>,
		// test-workbench_change end
		@IAgentHostGitService private readonly _agentHostGitService: IAgentHostGitService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async invoke(params: InvokeChangesetOperationParams, token: CancellationToken): Promise<InvokeChangesetOperationResult> {
		const abortController = new AbortController();
		if (token.isCancellationRequested) {
			abortController.abort();
		}
		const cancellationListener = token.onCancellationRequested(() => abortController.abort());
		try {
			return await this._invoke(params, token, abortController.signal);
		} finally {
			cancellationListener.dispose();
		}
	}

	private async _invoke(params: InvokeChangesetOperationParams, token: CancellationToken, _signal: AbortSignal): Promise<InvokeChangesetOperationResult> {
		// test-workbench_change start - the changeset-scoped variant discards every file at once.
		if (params.operationId === AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_ALL_CHANGES) {
			return this._invokeDiscardAll(params, token);
		}
		// test-workbench_change end

		const parsed = parseChangesetUri(params.channel);
		if (!parsed || parsed.kind !== ChangesetKind.Uncommitted) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Not an uncommitted changeset URI: ${params.channel}`);
		}
		this._throwIfCancelled(token);

		const sessionUri = parsed.sessionUri;
		const sessionState = this._getSessionState(sessionUri);
		if (!sessionState) {
			throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session not found: ${sessionUri}`);
		}

		if (params.target?.kind !== ChangesetOperationTargetKind.Resource) {
			throw new ProtocolError(
				JsonRpcErrorCodes.InvalidParams,
				`Operation '${AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES}' requires a resource target.`);
		}

		const workingDirectoryStr = sessionState.workingDirectories?.[0];
		if (!workingDirectoryStr) {
			throw new ProtocolError(JsonRpcErrorCodes.InternalError, `Session has no working directory: ${sessionUri}`);
		}

		const workingDirectory = URI.parse(workingDirectoryStr);
		const resource = URI.parse(params.target.resource);

		try {
			const repositoryRoot = await this._agentHostGitService.getRepositoryRoot(workingDirectory);
			this._throwIfCancelled(token);

			const untrackedPaths = repositoryRoot
				? await this._agentHostGitService.getUntrackedPaths(repositoryRoot)
				: undefined;
			this._throwIfCancelled(token);

			const isUntracked = repositoryRoot !== undefined
				&& untrackedPaths?.some(path => extUriBiasedIgnorePathCase.isEqual(URI.joinPath(repositoryRoot, path), resource));
			if (isUntracked) {
				const useTrash = this._fileService.hasCapability(resource, FileSystemProviderCapabilities.Trash);
				this._logService.info(`[AgentHostDiscardChangesOperationHandler] Deleting untracked file '${resource.fsPath}' for session ${sessionUri} (useTrash: ${useTrash})`);
				await this._fileService.del(resource, { useTrash });
			} else {
				this._logService.info(`[AgentHostDiscardChangesOperationHandler] Restoring '${resource.fsPath}' for session ${sessionUri}`);
				await this._agentHostGitService.restore(workingDirectory, [resource.fsPath]);
			}
		} catch (err) {
			this._throwIfCancelled(token);
			throw new ProtocolError(
				JsonRpcErrorCodes.InternalError,
				`Failed to discard changes: ${err instanceof Error ? err.message : String(err)}`);
		}

		return { message: { markdown: localize('agentHost.changeset.discardChanges.discarded', "Discarded changes to `{0}`.", basename(resource)) } };
	}

	// test-workbench_change start
	/**
	 * Discards every file's uncommitted working-tree changes for the session:
	 * restores tracked files from the index and deletes untracked files. Staged
	 * (index) changes are intentionally left untouched.
	 */
	private async _invokeDiscardAll(params: InvokeChangesetOperationParams, token: CancellationToken): Promise<InvokeChangesetOperationResult> {
		const parsed = parseChangesetUri(params.channel);
		if (!parsed || parsed.kind !== ChangesetKind.Uncommitted) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Not an uncommitted changeset URI: ${params.channel}`);
		}
		this._throwIfCancelled(token);

		const sessionUri = parsed.sessionUri;
		const sessionState = this._getSessionState(sessionUri);
		if (!sessionState) {
			throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session not found: ${sessionUri}`);
		}

		const workingDirectoryStr = sessionState.workingDirectories?.[0];
		if (!workingDirectoryStr) {
			throw new ProtocolError(JsonRpcErrorCodes.InternalError, `Session has no working directory: ${sessionUri}`);
		}

		const workingDirectory = URI.parse(workingDirectoryStr);

		try {
			const repositoryRoot = await this._agentHostGitService.getRepositoryRoot(workingDirectory) ?? workingDirectory;
			this._throwIfCancelled(token);

			// Restore tracked files from the index; this leaves staged changes in place.
			// Skip restore in a repository with no commits: `git restore .` fails there
			// with "pathspec '.' did not match any file(s) known to git".
			const headOid = await this._agentHostGitService.revParse(repositoryRoot, 'HEAD');
			this._throwIfCancelled(token);
			if (headOid) {
				this._logService.info(`[AgentHostDiscardChangesOperationHandler] Restoring all working-tree changes for session ${sessionUri}`);
				await this._agentHostGitService.restore(repositoryRoot, []);
				this._throwIfCancelled(token);
			}

			// Remove untracked files (they are not part of the index, so a restore cannot reach them).
			const untrackedPaths = await this._agentHostGitService.getUntrackedPaths(repositoryRoot) ?? [];
			for (const path of untrackedPaths) {
				this._throwIfCancelled(token);
				const resource = URI.joinPath(repositoryRoot, path);
				const useTrash = this._fileService.hasCapability(resource, FileSystemProviderCapabilities.Trash);
				this._logService.info(`[AgentHostDiscardChangesOperationHandler] Deleting untracked file '${resource.fsPath}' for session ${sessionUri} (useTrash: ${useTrash})`);
				await this._fileService.del(resource, { useTrash });
			}
		} catch (err) {
			this._throwIfCancelled(token);
			throw new ProtocolError(
				JsonRpcErrorCodes.InternalError,
				`Failed to discard all changes: ${err instanceof Error ? err.message : String(err)}`);
		}

		try {
			await this._onDiscarded(sessionUri);
		} catch (err) {
			this._logService.warn(`[AgentHostDiscardChangesOperationHandler] Post-discard refresh failed for session ${sessionUri}: ${err instanceof Error ? err.message : String(err)}`);
		}

		return { message: { markdown: localize('agentHost.changeset.discardAllChanges.discarded', "Discarded all uncommitted changes.") } };
	}
	// test-workbench_change end

	private _throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new ProtocolError(JsonRpcErrorCodes.InternalError, localize('agentHost.changeset.discardChanges.cancelled', "Discard changes operation was cancelled."));
		}
	}
}

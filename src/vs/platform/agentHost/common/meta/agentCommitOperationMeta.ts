/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
// Carries a caller-provided commit message for the `commit` changeset
// operation so the Agent Host commits with the exact text the user typed
// instead of generating one with GitHub Copilot.

import { localize } from '../../../../nls.js';
import { JsonRpcErrorCodes, ProtocolError } from '../state/sessionProtocol.js';

const COMMIT_MESSAGE_META_KEY = 'vscode.commitMessage';

interface IHasCommitMessageMeta {
	readonly _meta?: Record<string, unknown>;
}

/** Serializes a user-provided commit message for the open protocol metadata bag. */
export function createCommitOperationMeta(message: string): Record<string, unknown> {
	return { [COMMIT_MESSAGE_META_KEY]: message };
}

/**
 * Reads the caller-provided commit message, if any.
 *
 * Returns `undefined` when the caller did not supply one (or supplied only
 * whitespace) so the operation can reject the request as missing a required
 * message. Malformed values are rejected.
 */
export function readCommitOperationMessage(source: IHasCommitMessageMeta): string | undefined {
	const meta = source._meta;
	if (meta === undefined) {
		return undefined;
	}
	const value = meta[COMMIT_MESSAGE_META_KEY];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, localize('agentHost.changeset.commit.invalidMessage', "Invalid commit message."));
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

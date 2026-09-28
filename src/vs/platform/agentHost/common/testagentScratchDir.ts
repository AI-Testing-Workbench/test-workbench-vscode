/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import { joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

/**
 * Root that holds every workspace-less testagent chat scratch directory:
 * `<userHome>/.testagent/chats`. Exposed so callers can recognise (and trust)
 * scratch paths without knowing the individual session id.
 */
export function testagentChatsRoot(userHome: URI): URI {
	return joinPath(userHome, '.testagent', 'chats');
}

/**
 * Stable per-session scratch directory for a workspace-less testagent chat:
 * `<userHome>/.testagent/chats/<sessionId>`. Mirrors Copilot/Claude's
 * `~/.copilot/chats/<sessionId>` convention so a quick chat gets a deterministic,
 * persistent cwd instead of a throwaway `/tmp` directory.
 */
export function testagentScratchDir(userHome: URI, sessionId: string): URI {
	return joinPath(testagentChatsRoot(userHome), sessionId);
}

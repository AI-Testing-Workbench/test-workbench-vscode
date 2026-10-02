/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
// Shared identifiers for the tool view containers that the Agents window hosts in its auxiliary
// bar and surfaces through the Files tool's top activity bar.
//
// The Source Control and Extensions identifiers mirror the upstream `VIEWLET_ID` constants in
// `vs/workbench/contrib/scm/common/scm.ts` and `vs/workbench/contrib/extensions/common/extensions.ts`.
// They are duplicated here because this `/common` module must stay importable from `vs/sessions/browser`
// (which cannot depend on `vs/workbench/contrib`); the relocation contribution validates them.

/** The Files (Explorer) container hosted in the Agents window auxiliary bar. */
export const SESSIONS_FILES_CONTAINER_ID = 'workbench.sessions.auxiliaryBar.filesContainer';

/** Mirrors `VIEWLET_ID` from `vs/workbench/contrib/scm/common/scm.ts`. */
export const SESSIONS_SCM_CONTAINER_ID = 'workbench.view.scm';

/** Mirrors `VIEWLET_ID` from `vs/workbench/contrib/extensions/common/extensions.ts`. */
export const SESSIONS_EXTENSIONS_CONTAINER_ID = 'workbench.view.extensions';

/**
 * Containers surfaced by the Files tool's top activity bar, in display order.
 * Changes is intentionally excluded (it keeps its own detail panel).
 */
export const SESSIONS_FILES_TOOL_CONTAINER_IDS: readonly string[] = [
	SESSIONS_FILES_CONTAINER_ID,
	SESSIONS_SCM_CONTAINER_ID,
	SESSIONS_EXTENSIONS_CONTAINER_ID,
];

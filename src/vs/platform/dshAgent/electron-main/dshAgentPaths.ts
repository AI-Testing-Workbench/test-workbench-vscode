/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IDshAgentPaths, IDshAgentWindowSettings } from '../common/dshAgentPaths.js';
import { resolveDshAgentPaths as resolveNodePaths } from '../node/dshAgentPaths.js';

export { DSH_AGENT_RUNTIME_FORMAT, DEFAULT_DSH_AGENT_WINDOW_SETTINGS } from '../common/dshAgentPaths.js';
export type { IDshAgentPaths, IDshAgentWindowSettings } from '../common/dshAgentPaths.js';
export { createDshAgentHostEnvironment, findExecutable } from '../node/dshAgentPaths.js';

/** Electron-side wrapper: the application root is the only environment input. */
export function resolveDshAgentPaths(environmentMainService: IEnvironmentMainService, settings: IDshAgentWindowSettings): IDshAgentPaths {
	return resolveNodePaths(environmentMainService.appRoot, environmentMainService.userDataPath, settings);
}

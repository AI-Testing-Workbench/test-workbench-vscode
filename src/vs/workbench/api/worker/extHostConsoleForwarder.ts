/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbstractExtHostConsoleForwarder } from '../common/extHostConsoleForwarder.js';
import { IExtHostInitDataService } from '../common/extHostInitDataService.js';
// test-workbench_change start
import { IExtHostExtensionService } from '../common/extHostExtensionService.js';
// test-workbench_change end
import { IExtHostRpcService } from '../common/extHostRpcService.js';

export class ExtHostConsoleForwarder extends AbstractExtHostConsoleForwarder {

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
		// test-workbench_change start
		@IExtHostExtensionService extHostExtensionService: IExtHostExtensionService,
		// test-workbench_change end
	) {
		// test-workbench_change start
		super(extHostRpc, initData, extHostExtensionService);
		// test-workbench_change end
	}

	protected override _nativeConsoleLogMessage(_method: unknown, original: (...args: unknown[]) => void, args: unknown[]) {
		original.apply(console, args);
	}
}

// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js'; // test-workbench_change
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IModeSwitchService } from '../../../services/modeSwitch/common/modeSwitchService.js';
import { WorkbenchModeContext } from '../common/modeSwitchContextKeys.js';

class ModeSwitchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.modeSwitch';

	private readonly modeSwitchContextKey: IContextKey<string>;

	constructor(
		@IModeSwitchService private readonly modeSwitchService: IModeSwitchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService private readonly logService: ILogService // test-workbench_change
	) {
		super();

		// Initialize context key
		this.modeSwitchContextKey = WorkbenchModeContext.bindTo(contextKeyService);
		this.modeSwitchContextKey.set(this.modeSwitchService.currentMode);

		// Listen for mode changes
		// test-workbench_change start - performance timing
		this._register(this.modeSwitchService.onDidChangeMode(mode => {
			const startTime = performance.now();
			this.modeSwitchContextKey.set(mode);
			const elapsed = performance.now() - startTime;
			if (elapsed > 100) {
				this.logService.warn(`[ModeSwitchContribution] Button update for ${mode} mode took ${elapsed.toFixed(2)}ms (exceeds 100ms threshold)`);
			}
		}));
		// test-workbench_change end
	}
}

// Register contribution
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(ModeSwitchContribution, LifecyclePhase.Restored);

// Import service implementation to trigger registration // test-workbench_change
import '../../../services/modeSwitch/browser/modeSwitchService.js'; // test-workbench_change

// Import actions
import './modeSwitchActions.js';

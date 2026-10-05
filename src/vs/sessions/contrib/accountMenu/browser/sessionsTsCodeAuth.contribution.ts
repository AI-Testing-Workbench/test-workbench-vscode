/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { ITsCodeAuthService, ITsCodeTokenStore } from '../../../../workbench/contrib/tsCodeAuth/common/tsCodeAuth.js';
import { TsCodeAuthService } from '../../../../workbench/contrib/tsCodeAuth/browser/tsCodeAuthService.js';
import { TsCodeTokenStore } from '../../../../workbench/contrib/tsCodeAuth/browser/tsCodeTokenStore.js';
import { TsCodeOAuthProvider } from '../../../../workbench/contrib/tsCodeAuth/browser/tsCodeOAuthProvider.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../workbench/common/contributions.js';

// test-workbench_change start
/**
 * Wires the TestAgent (tsCode OAuth) authentication into the Agents window so its
 * account entry can sign in/out and reflect the TestAgent session, mirroring the
 * editor window. Unlike the editor contribution this intentionally does not install
 * the full-screen welcome overlay or open the welcome editor.
 */
registerSingleton(ITsCodeTokenStore, TsCodeTokenStore, InstantiationType.Delayed);
registerSingleton(ITsCodeAuthService, TsCodeAuthService, InstantiationType.Delayed);

export class SessionsTsCodeAuthContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sessionsTsCodeAuth';

	constructor(
		@IAuthenticationService authenticationService: IAuthenticationService,
		@ITsCodeAuthService private readonly authService: ITsCodeAuthService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		const oauthProvider = instantiationService.createInstance(TsCodeOAuthProvider);
		authenticationService.registerAuthenticationProvider(oauthProvider.id, oauthProvider);

		// Resolve the current token (and auto-provision in mock mode) so the account
		// entry and the `tscodeAuth.signedIn` context reflect the real state.
		void this.authService.checkAndHandleAuth();
	}
}

registerWorkbenchContribution2(SessionsTsCodeAuthContribution.ID, SessionsTsCodeAuthContribution, WorkbenchPhase.BlockRestore);
// test-workbench_change end

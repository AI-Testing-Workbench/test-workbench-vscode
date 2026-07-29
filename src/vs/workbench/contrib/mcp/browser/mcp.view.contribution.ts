/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

<<<<<<<< HEAD:src/vs/base/common/productEncoding.ts
export function decodeProductUrl(value: string): string {
	try {
		if (typeof atob === 'function') {
			return atob(value);
		}
		if (typeof Buffer !== 'undefined') {
			return Buffer.from(value, 'base64').toString('utf-8');
		}
	} catch {
		// ignore decode errors
	}
	return value;
}
========
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { McpServersViewsContribution } from './mcpServersView.js';

registerWorkbenchContribution2(McpServersViewsContribution.ID, McpServersViewsContribution, WorkbenchPhase.AfterRestored);
>>>>>>>> upstream/main:src/vs/workbench/contrib/mcp/browser/mcp.view.contribution.ts

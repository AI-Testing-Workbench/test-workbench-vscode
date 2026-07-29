/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

<<<<<<<< HEAD:src/vs/workbench/contrib/chat/browser/chat.view.contribution.ts
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { AgentPluginsViewsContribution } from './agentPluginsView.js';

registerWorkbenchContribution2(AgentPluginsViewsContribution.ID, AgentPluginsViewsContribution, WorkbenchPhase.AfterRestored);
========
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';

export const EmptyTextEditorHintContributionId = 'editor.contrib.emptyTextEditorHint';

export interface IEmptyTextEditorHintContribution extends IEditorContribution {
	disposeHint(): void;
}
>>>>>>>> upstream/main:src/vs/workbench/contrib/codeEditor/browser/emptyTextEditorHint/emptyTextEditorHintTypes.ts

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { CodeReviewService, ICodeReviewService } from './codeReviewService.js';

registerSingleton(ICodeReviewService, CodeReviewService, InstantiationType.Delayed);

// test-workbench_change start — Run Code Review UI 暂时下线:内置 code-review skill 未接入
// testagent 后端(TestAgent provider 忽略 host customizations,只从后端 API 拉清单;见
// testagentAgent.ts / testagentCustomizations.ts),点击按钮不会触发审查。待后端对接完成后,
// 取消下面整段注释即可恢复按钮。以上 ICodeReviewService 注册(PR 评论服务)与本按钮无关,保持启用。
//
// import { Codicon } from '../../../../base/common/codicons.js';
// import { URI } from '../../../../base/common/uri.js';
// import { localize, localize2 } from '../../../../nls.js';
// import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
// import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
// import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
// import { ActiveEditorContext, IsAuxiliaryWindowContext, IsSessionsWindowContext, IsTopRightEditorGroupContext } from '../../../../workbench/common/contextkeys.js';
// import { IsPhoneLayoutContext, SessionHasChangesContext, SessionIsCreatedContext, SessionWorkspaceIsVirtualContext, SessionProviderIdContext, SinglePaneLayoutEnabledContext } from '../../../common/contextkeys.js';
// import { ChatContextKeys } from '../../../../workbench/contrib/chat/common/actions/chatContextKeys.js';
// import { CHAT_CATEGORY } from '../../../../workbench/contrib/chat/browser/actions/chatActions.js';
// import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
// import { ISessionsService } from '../../../services/sessions/browser/sessionsService.js';
// import { IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
// import { ANY_AGENT_HOST_PROVIDER_RE } from '../../../common/agentHostSessionsProvider.js';
// import { Menus } from '../../../browser/menus.js';
// import { SessionChangesEditorInput } from '../../changes/browser/sessionChangesEditorInput.js';
// import { ISessionChangesService } from '../../changes/browser/sessionChangesService.js';
//
// const CODE_REVIEW_QUERY = '/code-review';
//
// const singlePaneDetailPanel = SinglePaneLayoutEnabledContext;
//
// // Code review is shown in the single-pane editor title bar, so it is only
// // contributed to the classic changes button bar when single-pane is off.
// const codeReviewChangesToolbarWhen = ContextKeyExpr.and(
// 	IsSessionsWindowContext,
// 	SessionWorkspaceIsVirtualContext.toNegated(),
// 	IsPhoneLayoutContext.negate(),
// 	SessionIsCreatedContext,
// 	ContextKeyExpr.regex(SessionProviderIdContext.key, ANY_AGENT_HOST_PROVIDER_RE),
// 	singlePaneDetailPanel.negate(),
// );
//
// const singlePaneCodeReviewWhen = ContextKeyExpr.and(
// 	IsSessionsWindowContext,
// 	ActiveEditorContext.isEqualTo(SessionChangesEditorInput.EDITOR_ID),
// 	singlePaneDetailPanel,
// 	IsAuxiliaryWindowContext.toNegated(),
// 	IsTopRightEditorGroupContext,
// 	SessionWorkspaceIsVirtualContext.toNegated(),
// 	SessionIsCreatedContext,
// 	SessionHasChangesContext,
// );
//
// class RunSessionCodeReviewAction extends Action2 {
//
// 	static readonly ID = 'sessions.codeReview.run';
//
// 	constructor() {
// 		super({
// 			id: RunSessionCodeReviewAction.ID,
// 			title: localize2('sessions.runCodeReview', "Run Code Review"),
// 			tooltip: localize('sessions.runCodeReview.tooltip', "Run Code Review"),
// 			category: CHAT_CATEGORY,
// 			icon: Codicon.codeReview,
// 			precondition: ContextKeyExpr.or(ChatContextKeys.hasAgentSessionChanges, SessionHasChangesContext),
// 			menu: [
// 				{
// 					id: MenuId.AgentsChangesToolbar,
// 					group: 'navigation',
// 					order: 7,
// 					when: codeReviewChangesToolbarWhen,
// 				},
// 				{
// 					id: Menus.SessionsEditorHeaderLayout,
// 					group: 'navigation',
// 					order: 10,
// 					when: singlePaneCodeReviewWhen,
// 				},
// 			],
// 		});
// 	}
//
// 	override async run(accessor: ServicesAccessor, sessionResource?: URI): Promise<void> {
// 		const sessionManagementService = accessor.get(ISessionsManagementService);
// 		const sessionsService = accessor.get(ISessionsService);
// 		const chatWidgetService = accessor.get(IChatWidgetService);
// 		const sessionChangesService = accessor.get(ISessionChangesService);
//
// 		const candidateResource = URI.isUri(sessionResource)
// 			? sessionResource
// 			: sessionsService.activeSession.get()?.resource;
// 		const resource = candidateResource
// 			? sessionChangesService.getSessionResource(candidateResource) ?? candidateResource
// 			: undefined;
// 		if (!resource) {
// 			return;
// 		}
//
// 		const session = sessionManagementService.getSession(resource);
// 		if (!session) {
// 			return;
// 		}
//
// 		if (session.capabilities.get().supportsMultipleChats) {
// 			await sessionManagementService.sendNewChatRequest(session, { query: CODE_REVIEW_QUERY });
// 		} else {
// 			chatWidgetService.getWidgetBySessionResource(session.resource)?.acceptInput(CODE_REVIEW_QUERY);
// 		}
// 	}
// }
//
// registerAction2(RunSessionCodeReviewAction);
// test-workbench_change end

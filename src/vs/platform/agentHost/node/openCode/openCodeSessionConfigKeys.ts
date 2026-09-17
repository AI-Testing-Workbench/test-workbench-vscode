/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import { localize } from '../../../../nls.js';
import { createSchema, schemaProperty } from '../../common/agentHostSchema.js';
import type { IOpenCodePermissionRule } from './openCodeSession.js';

/**
 * Well-known session-config keys advertised by the OpenCode(TestAgent)
 * provider in its `resolveChatConfig` schema.
 *
 * OpenCode 的审批模型是会话级 permission ruleset(`PATCH /session/:id
 * { permission }`,allow/deny/ask × 通配符)。平台把多档审批折叠为单一
 * `permissionMode` 轴,取值经 {@link mapOpenCodePermissionRules} 翻译成
 * ruleset;`default` 表示不覆盖,沿用 opencode 自身配置。
 */
export const enum OpenCodeSessionConfigKey {
	/** `'permissionMode'` — OpenCode 会话审批模式。 */
	PermissionMode = 'permissionMode',
}

export type OpenCodePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** `resolveChatConfig` 的 schema(与 Claude 的 permissionMode 轴同构)。 */
export const openCodeSessionSchema = createSchema({
	[OpenCodeSessionConfigKey.PermissionMode]: schemaProperty<OpenCodePermissionMode>({
		type: 'string',
		title: localize('openCode.sessionConfig.permissionMode', "Approvals"),
		description: localize('openCode.sessionConfig.permissionModeDescription', "How TestAgent handles tool approvals."),
		enum: ['default', 'acceptEdits', 'bypassPermissions'],
		enumLabels: [
			localize('openCode.sessionConfig.permissionMode.default', "Ask Before Edits"),
			localize('openCode.sessionConfig.permissionMode.acceptEdits', "Edit Automatically"),
			localize('openCode.sessionConfig.permissionMode.bypassPermissions', "Bypass Permissions"),
		],
		enumDescriptions: [
			localize('openCode.sessionConfig.permissionMode.defaultDescription', "TestAgent follows its own configuration and asks before tools that require approval."),
			localize('openCode.sessionConfig.permissionMode.acceptEditsDescription', "File-editing tools run without asking; everything else follows the session defaults."),
			localize('openCode.sessionConfig.permissionMode.bypassPermissionsDescription', "All tools run without asking."),
		],
		default: 'default',
		sessionMutable: true,
	}),
});

/**
 * 将 permissionMode 翻译为 opencode 会话级 ruleset。
 * `undefined` = 不下发(后端自身配置生效)。opencode 的权限名是工具名
 * (shell 权限名为 `bash`,见 permission/arity 与 mapForkPermissionKind),
 * pattern/permission 支持 `*` 通配(permission/evaluate 的 Wildcard 匹配)。
 */
export function mapOpenCodePermissionRules(mode: OpenCodePermissionMode | undefined): readonly IOpenCodePermissionRule[] | undefined {
	switch (mode) {
		case 'acceptEdits':
			return [
				{ permission: 'edit', pattern: '*', action: 'allow' },
				{ permission: 'write', pattern: '*', action: 'allow' },
				{ permission: 'apply_patch', pattern: '*', action: 'allow' },
			];
		case 'bypassPermissions':
			return [{ permission: '*', pattern: '*', action: 'allow' }];
		default:
			return undefined;
	}
}

/** 把任意 runtime 值收窄到 {@link OpenCodePermissionMode}。 */
export function narrowOpenCodePermissionMode(raw: unknown): OpenCodePermissionMode | undefined {
	switch (raw) {
		case 'default':
		case 'acceptEdits':
		case 'bypassPermissions':
			return raw;
		default:
			return undefined;
	}
}

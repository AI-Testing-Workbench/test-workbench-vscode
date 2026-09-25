/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../base/common/observable.js';
import { PolicyCategory } from '../../../base/common/policy.js';
import * as nls from '../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../configuration/common/configurationRegistry.js';
import { RawContextKey } from '../../contextkey/common/contextkey.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Registry } from '../../registry/common/platform.js';

/** Context key set by {@link IAgentHostEnablementService}. Use in `when` clauses to gate Agent Host UI. */
export const AGENT_HOST_ENABLED_CONTEXT_KEY = new RawContextKey<boolean>('agentHostEnabled', false, { type: 'boolean', description: nls.localize('agentHostEnabled', "Whether Agent Host features are available and AI features are enabled in this window.") });

/** Hidden setting that gates the current-harness indicator for existing Agent Host sessions in the main VS Code window. */
export const AgentHostExistingSessionHarnessPickerEnabledSettingId = 'chat.editor.agentHost.existingSessionHarnessPicker.enabled';

// test-workbench_change start
/**
 * 主编辑器窗口是否接入 Agent Host。**schema 默认 false**:编辑器窗口不再自动连接 Agent Host
 * (从而不拉起 testagent 后端、隐藏内置 Chat 视图);`agentsWindow.default: true` 保证 Agents
 * 窗口不受影响(其配置服务会采用 agentsWindow 默认值)。
 * 注意:不要复用 `chat.disableAIFeatures`——它还会连带隐藏 Agents 窗口入口。
 */
export const AgentHostEditorEnabledSettingId = 'chat.editor.agentHost.enabled';
// test-workbench_change end

/** Effective setting or experiment value for the existing-session harness indicator in the main VS Code window. */
export const AGENT_HOST_EXISTING_SESSION_HARNESS_PICKER_ENABLED_CONTEXT_KEY = new RawContextKey<boolean>('agentHostExistingSessionHarnessPickerEnabled', false, { type: 'boolean', description: nls.localize('agentHostExistingSessionHarnessPickerEnabled', "Whether existing Agent Host sessions in the main VS Code window show the current harness as a disabled picker.") });

export const IAgentHostEnablementService = createDecorator<IAgentHostEnablementService>('agentHostEnablementService');

export interface IAgentHostEnablementService {
	readonly _serviceBrand: undefined;
	/**
	 * Whether Agent Host features are available and AI features are enabled in this window.
	 */
	readonly enabled: IObservable<boolean>;
	/**
	 * Whether an enterprise has mandated the Copilot SDK sandbox floor through managed settings
	 * (`sandbox.enabled`). The runtime owns composing and enforcing that floor; VS Code reads it
	 * only to retire the legacy local harness for governed users, since the sandbox is implemented
	 * by the Agent Host.
	 *
	 * A user- or workspace-level sandbox opt-in is not an enterprise decision and does not set
	 * this. Existing local chat sessions keep working; only the harness used for *new* chats is
	 * affected, and virtual workspaces are exempt.
	 */
	readonly managedSandboxEnforced: IObservable<boolean>;
	readonly managedSandboxAllowsBypass: IObservable<boolean>;
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'chatAgentHost',
	title: nls.localize('chatAgentHostConfigurationTitle', "Chat Agent Host"),
	type: 'object',
	properties: {
		'chat.editor.preferCopilotHarness': {
			type: 'boolean',
			description: nls.localize('chat.editor.preferCopilotHarness', "When enabled, uses the Agent Host Copilot SDK whenever the local harness would otherwise be selected for a new editor chat session. Claude and Codex selections are unaffected."),
			default: false,
			tags: ['experimental'],
			experiment: { mode: 'startup' },
			policy: {
				name: 'ChatEditorPreferCopilotHarness',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.134',
				localization: {
					description: {
						key: 'chat.editor.preferCopilotHarness.policy',
						value: nls.localize('chat.editor.preferCopilotHarness.policy', "Configure whether VS Code uses the Agent Host Copilot SDK instead of the local harness for new editor chat sessions."),
					},
				},
			},
		},
		'chat.defaultToCopilotHarness': {
			type: 'boolean',
			description: nls.localize('chat.defaultToCopilotHarness', "When enabled, new editor and panel chat sessions default to the Agent Host Copilot SDK instead of the local harness."),
			default: false,
			tags: ['experimental'],
			experiment: { mode: 'startup' },
		},
		'chat.editor.localAgent.enabled': {
			type: 'boolean',
			description: nls.localize('chat.editor.localAgent.enabled', "When enabled, shows the VS Code local chat harness in the chat picker. This setting is ignored in virtual workspaces, where the local chat harness is always available."),
			default: true,
			tags: ['experimental'],
			experiment: { mode: 'startup' },
		},
		[AgentHostExistingSessionHarnessPickerEnabledSettingId]: {
			type: 'boolean',
			description: nls.localize('chat.editor.agentHost.existingSessionHarnessPicker.enabled', "When enabled, existing Agent Host sessions in the main VS Code window show the current harness as a disabled picker."),
			default: false,
			included: false,
			tags: ['experimental'],
		},
		// test-workbench_change start
		// 编辑器窗口 Agent Host 开关(Agents 窗口恒为 true)
		[AgentHostEditorEnabledSettingId]: {
			type: 'boolean',
			description: nls.localize('chat.editor.agentHost.enabled', "When enabled, the main editor window connects to the Agent Host (and starts its backend). Disable to keep the editor window from starting the Agent Host backend. The Agents window is unaffected."),
			default: false,
			// 注意:不能加 `included: false`——被排除的设置不会进入默认配置模型,导致 getValue() 返回 undefined、
			// 编辑器窗口解析不到默认 false(以及 Agents 窗口解析不到 agentsWindow 默认 true)。故此处保持可见注册。
			tags: ['experimental'],
			agentsWindow: { default: true, readOnly: true },
		},
		// test-workbench_change end
	}
});

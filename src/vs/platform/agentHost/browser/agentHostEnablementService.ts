/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { derived, IObservable, observableFromEvent } from '../../../base/common/observable.js';
import { isWeb } from '../../../base/common/platform.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ChatAIDisabledSettingId } from '../../chat/common/chatSettings.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { bindContextKey, observableConfigValue } from '../../observable/common/platformObservableUtils.js';
import { COPILOT_SANDBOX_ALLOW_BYPASS_KEY, COPILOT_SANDBOX_ENABLED_KEY, IManagedSettingsService } from '../../policy/common/copilotManagedSettings.js';
import { AGENT_HOST_ENABLED_CONTEXT_KEY, AgentHostEditorEnabledSettingId, IAgentHostEnablementService } from '../common/agentHostEnablementService.js'; // test-workbench_change

export class AgentHostEnablementService extends Disposable implements IAgentHostEnablementService {

	declare readonly _serviceBrand: undefined;

	readonly enabled: IObservable<boolean>;
	readonly managedSandboxEnforced: IObservable<boolean>;
	readonly managedSandboxAllowsBypass: IObservable<boolean>;

	constructor(
		private readonly _isAgentHostRuntimeAvailable: boolean,
		configurationService: IConfigurationService,
		contextKeyService: IContextKeyService,
		managedSettingsService: IManagedSettingsService,
	) {
		super();
		const aiFeaturesDisabled = observableConfigValue(ChatAIDisabledSettingId, false, configurationService);
		// test-workbench_change start
		// 叠加编辑器窗口 Agent Host 开关。真实窗口的 configurationService 总会解析出 schema 默认值(false),
		// 故此处的 fallback 仅用于未注册/未解析(如单测 mock)场景,取 true 以保持上游单测语义不变;
		// Agents 窗口经 agentsWindow 默认恒为 true。
		const editorAgentHostEnabled = observableConfigValue(AgentHostEditorEnabledSettingId, true, configurationService);
		this.enabled = derived(this, reader => this._isAgentHostRuntimeAvailable && !aiFeaturesDisabled.read(reader) && editorAgentHostEnabled.read(reader));
		// test-workbench_change end
		this._register(bindContextKey(AGENT_HOST_ENABLED_CONTEXT_KEY, contextKeyService, reader => this.enabled.read(reader)));

		this.managedSandboxEnforced = observableFromEvent(this,
			managedSettingsService.onDidChangeManagedSettings,
			() => managedSettingsService.getManagedSettingValue(COPILOT_SANDBOX_ENABLED_KEY) === true);
		this.managedSandboxAllowsBypass = observableFromEvent(this,
			managedSettingsService.onDidChangeManagedSettings,
			() => managedSettingsService.getManagedSettingValue(COPILOT_SANDBOX_ALLOW_BYPASS_KEY) === true);
	}
}

class BrowserAgentHostEnablementService extends AgentHostEnablementService {
	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IManagedSettingsService managedSettingsService: IManagedSettingsService,
	) {
		super(!isWeb, configurationService, contextKeyService, managedSettingsService);
	}
}

registerSingleton(IAgentHostEnablementService, BrowserAgentHostEnablementService, InstantiationType.Eager);

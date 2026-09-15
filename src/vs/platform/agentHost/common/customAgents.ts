/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqualOrParent } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { isCustomizationEnabled } from './customizationEnablement.js';
import { AGENT_HOST_SCHEME, fromAgentHostUri } from './agentHostUri.js'; // test-workbench_change
import { CustomizationType, type AgentCustomization, type ClientPluginCustomization, type Customization } from './state/protocol/state.js';

/**
 * Computes the effective set of selectable custom agents for a session.
 *
 * Custom agents live as {@link CustomizationType.Agent | `Agent`} entries
 * in each container customization's {@link Customization.children | `children`}
 * array. Only the agent host populates `children` (after parsing the
 * container). Disabled containers are skipped; containers with an absent
 * `children` field are treated as "unknown" (e.g. the host has not finished
 * parsing yet) and skipped, while an empty array means "no children
 * contributed" and is respected.
 *
 * The picker is keyed on the agent's stable {@link AgentCustomization.uri};
 * duplicates within the session's customization list are coalesced.
 */
export function getEffectiveAgents(
	sessionCustomizations: readonly Customization[] | undefined,
): readonly AgentCustomization[] {
	const seen = new Map<string, AgentCustomization>();
	if (sessionCustomizations) {
		for (const container of sessionCustomizations) {
			if (container.type === CustomizationType.McpServer) {
				continue;
			}
			if ((container.type === CustomizationType.Plugin && !isCustomizationEnabled(container)) || (container.type === CustomizationType.Directory && !container.enabled) || !container.children) {
				continue;
			}
			for (const child of container.children) {
				if (child.type !== CustomizationType.Agent) {
					continue;
				}
				const key = child.uri.toString();
				if (!seen.has(key)) {
					seen.set(key, child);
				}
			}
		}
	}
	const result = [...seen.values()];
	result.sort((a, b) => a.name.localeCompare(b.name) || a.uri.toString().localeCompare(b.uri.toString()));
	return result;
}

/**
 * Filters draft agents by their published plugin container enablement.
 * Unmatched agents remain selectable because they may be loose agents or precede
 * their plugin ref during a client update.
 */
export function getEffectiveClientAgents(
	clientCustomizations: readonly ClientPluginCustomization[] | undefined,
	clientAgents: readonly AgentCustomization[],
): readonly AgentCustomization[] {
	if (!clientCustomizations || clientCustomizations.length === 0) {
		return clientAgents;
	}
	return clientAgents.filter(agent => {
		const agentUri = URI.parse(agent.uri);
		const plugin = clientCustomizations.find(candidate => isEqualOrParent(agentUri, URI.parse(candidate.uri)));
		return !plugin || isCustomizationEnabled(plugin);
	});
}

/**
 * Storage key used by the custom-agent pickers to remember the user's last
 * selection per session-resource scheme. Shared between the Agents Window
 * picker and the workbench chat-editor picker so the two surfaces agree on
 * the default for new (untitled) sessions.
 */
export function agentHostAgentPickerStorageKey(resourceScheme: string): string {
	return `workbench.agentsession.agentHostAgentPicker.${resourceScheme}.selectedAgentUri`;
}

/**
 * Resolves the agent that should be shown for a session:
 * - If the session has a current selection and it exists in the effective list, use it.
 * - Else if a stored agent URI matches an entry in the list, use that entry.
 * - Else `undefined` (the default "Agent" placeholder row).
 *
 * `sessionAgentUri` accepts either a platform {@link URI} instance or a raw
 * URI string. The agent-host protocol
 * {@link import('./state/protocol/state.js').AgentSelection} URI field and the
 * sessions-layer `ISessionAgentRef` both provide URI strings.
 */
export function resolveAgentHostAgent(
	agents: readonly AgentCustomization[],
	sessionAgentUri: URI | string | undefined,
	storedAgentUri: string | undefined,
): AgentCustomization | undefined {
	if (sessionAgentUri !== undefined) {
		const sessionStr = typeof sessionAgentUri === 'string' ? sessionAgentUri : sessionAgentUri.toString();
		const match = agents.find(a => normalizeAgentUri(a.uri) === normalizeAgentUri(sessionStr)); // test-workbench_change
		if (match) {
			return match;
		}
	}
	return storedAgentUri ? agents.find(a => normalizeAgentUri(a.uri) === normalizeAgentUri(storedAgentUri)) : undefined; // test-workbench_change
}

// test-workbench_change start
/**
 * Chat mode 的 id 是 customization URI 经 `toAgentHostUri` 包装后的形式
 * （`vscode-agent-host://[auth]/path?_ah=[meta]`），而会话 customizations 里
 * 记录的是原始 URI（如 `opencode-customization:/agents/plan`）。直接字符串比较
 * 永远不相等，picker 会误判“所选 agent 已不在列表”而把选择重置回 default。
 * 比较前两侧都尝试解包回原始 URI；本地 `file://` 的包装本来就是恒等变换，
 * 行为与上游一致。
 */
function normalizeAgentUri(uri: string): string {
	if (!uri.startsWith(`${AGENT_HOST_SCHEME}:`)) {
		return uri;
	}
	try {
		return fromAgentHostUri(URI.parse(uri)).toString(true);
	} catch {
		return uri;
	}
}
// test-workbench_change end

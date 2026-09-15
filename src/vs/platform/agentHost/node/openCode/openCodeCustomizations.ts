// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../log/common/log.js';
import { CustomizationType } from '../../common/state/protocol/channels-session/state.js';
import { CustomizationLoadStatus, customizationId, type AgentCustomization, type ChildCustomization, type Customization, type DirectoryCustomization, type SkillCustomization } from '../../common/state/sessionState.js';

/** GET /skill → Skill.Info[]（fork: packages/opencode/src/skill/index.ts） */
interface ISkillInfo { name: string; description?: string; location?: string }
/** GET /command → Command.Info[]；fork 把 skills 合并进命令表（source === 'skill'），此处去重 */
interface ICommandInfo { name: string; description?: string; source?: 'command' | 'mcp' | 'skill' }
/** GET /agent → Agent.Info[] */
interface IAgentInfo { name: string; description?: string; hidden?: boolean; model?: { modelID?: string; providerID?: string } }

/** 合成 scheme：opencode 的清单来自运行时 API 而非固定磁盘目录，条目不可点开/不可写 */
const OPENCODE_SCHEME = 'opencode-customization';

async function fetchList<T>(baseUrl: string, path: string, authHeader: string, workingDirectory: URI | undefined, logService: ILogService): Promise<T[] | undefined> {
	const headers: Record<string, string> = {};
	if (authHeader) { headers['Authorization'] = authHeader; }
	// header 值只允许 Latin-1，中文路径 percent-encode（服务端 workspace-routing 解码）
	if (workingDirectory) { headers['x-opencode-directory'] = encodeURIComponent(workingDirectory.fsPath); }
	try {
		const resp = await fetch(`${baseUrl}${path}`, { headers });
		if (!resp.ok) { return undefined; }
		const data = await resp.json();
		return Array.isArray(data) ? data as T[] : undefined;
	} catch (err) {
		logService.warn(`[OpenCode] customizations GET ${path} failed: ${err}`);
		return undefined;
	}
}

function container(name: string, contents: SkillCustomization['type'] | AgentCustomization['type'], children: readonly ChildCustomization[]): DirectoryCustomization {
	const uri = `${OPENCODE_SCHEME}:/` + name;
	return {
		type: CustomizationType.Directory,
		id: customizationId(uri),
		uri,
		name,
		enabled: true,
		contents,
		writable: false,
		load: { kind: CustomizationLoadStatus.Loaded },
		children: [...children],
	};
}

/**
 * 从 fork server 拉取 skills / commands / agents 清单并映射为协议 Customization。
 * 参考 Claude provider 的 discovery 输出形状；数据源换成 HTTP API，不做文件扫描。
 * 单个端点失败只省略对应容器；全失败返回空数组（调用方 TTL 缓存不存空结果以外的错误）。
 */
export async function fetchOpenCodeCustomizations(baseUrl: string, authHeader: string, workingDirectory: URI | undefined, logService: ILogService): Promise<readonly Customization[]> {
	const [skills, commands, agents] = await Promise.all([
		fetchList<ISkillInfo>(baseUrl, '/skill', authHeader, workingDirectory, logService),
		fetchList<ICommandInfo>(baseUrl, '/command', authHeader, workingDirectory, logService),
		fetchList<IAgentInfo>(baseUrl, '/agent', authHeader, workingDirectory, logService),
	]);

	const result: Customization[] = [];

	if (skills?.length) {
		const children: SkillCustomization[] = skills.map(s => {
			const uri = s.location ? URI.file(s.location).toString(true) : `${OPENCODE_SCHEME}:/skills/${s.name}`;
			return { type: CustomizationType.Skill, id: customizationId(uri), uri, name: s.name, description: s.description };
		});
		result.push(container('skills', CustomizationType.Skill, children));
	}

	if (commands?.length) {
		// source==='skill' 的条目已由 /skill 容器呈现，去重；mcp prompt 命令保留
		const children: SkillCustomization[] = commands.filter(c => c.source !== 'skill').map(c => {
			const uri = `${OPENCODE_SCHEME}:/commands/${c.name}`;
			return { type: CustomizationType.Skill, id: customizationId(uri), uri, name: `/${c.name}`, description: c.description };
		});
		if (children.length) { result.push(container('commands', CustomizationType.Skill, children)); }
	}

	if (agents?.length) {
		const children: AgentCustomization[] = agents.map(a => {
			const uri = `${OPENCODE_SCHEME}:/agents/${a.name}`;
			return {
				type: CustomizationType.Agent,
				id: customizationId(uri),
				uri,
				name: a.name,
				description: a.description,
				model: a.model?.providerID && a.model.modelID ? `${a.model.providerID}/${a.model.modelID}` : undefined,
				disableUserInvocation: a.hidden || undefined,
			};
		});
		result.push(container('agents', CustomizationType.Agent, children));
	}

	return result;
}

// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../log/common/log.js';
import { CustomizationType } from '../../common/state/protocol/channels-session/state.js';
import { CustomizationLoadStatus, customizationId, type AgentCustomization, type ChildCustomization, type Customization, type DirectoryCustomization, type RuleCustomization, type SkillCustomization } from '../../common/state/sessionState.js';

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

/**
 * 用户级 testagent 配置根目录(与后端 global.ts 约定一致:`$XDG_CONFIG_HOME ?? ~/.config` + `testagent`)。
 * // test-workbench_change — deleteCustomization 复用
 */
export function userTestagentConfigRoot(): string {
	const base = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
	return path.join(base, 'testagent');
}

/**
 * 用户级 testagent 配置目录（与后端 global.ts 约定一致：`$XDG_CONFIG_HOME ?? ~/.config` + `testagent`）。
 * 返回其下 agent/skills/commands 子目录的 file URI，并尽力创建目录。容器指向真实可写目录后，
 * 管理面板的 "New Agent/Skill/Prompt"（provideSourceFolders）即可落盘到此；清单条目本身
 * 仍来自运行时 API（合成 URI 只读），新文件要等 testagent 实例重建后出现于清单。
 * // test-workbench_change
 */
function userConfigSubDir(sub: string, logService: ILogService): URI {
	const dir = path.join(userTestagentConfigRoot(), sub);
	try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { logService.warn(`[OpenCode] failed to ensure customization dir ${dir}: ${err}`); }
	return URI.file(dir);
}

function container(name: string, contents: SkillCustomization['type'] | AgentCustomization['type'] | RuleCustomization['type'], children: readonly ChildCustomization[], writableDir: URI | undefined, logService: ILogService): DirectoryCustomization {
	// test-workbench_change start — 容器 uri 优先指向真实可写的用户级目录(供 New Agent/Skill/Prompt
	// 落盘，provideSourceFolders 只收 writable:true 的目录容器)；无落点时退回合成只读 uri。
	const uri = writableDir ? writableDir.toString(true) : `${OPENCODE_SCHEME}:/` + name;
	return {
		type: CustomizationType.Directory,
		id: customizationId(uri),
		uri,
		name,
		enabled: true,
		contents,
		writable: !!writableDir,
		load: { kind: CustomizationLoadStatus.Loaded },
		children: [...children],
	};
	// test-workbench_change end
}

/**
 * opencode 后端 `session/instruction.ts` 实际加载为 system instructions 的 rules 文件
 * （AGENTS.md 系列）候选路径。provider 侧磁盘扫描这些路径映射成 `CustomizationType.Rule`，
 * 对齐 Claude 的 `claudeRuleScan`：真实 `file:` uri、`alwaysApply`、可点开编辑。
 * 后端总是加载这些文件，故不提供 enablement 开关、不支持删除（AGENTS.md 是核心文件）；
 * 祖先目录 findUp 与 Claude 一样不在范围内（只查项目根与已知子目录）。
 * // test-workbench_change
 */
function ruleCandidatePaths(workingDirectory: URI | undefined): string[] {
	const home = os.homedir();
	const xdg = process.env['XDG_CONFIG_HOME'] || path.join(home, '.config');
	const out: string[] = [
		path.join(xdg, 'testagent', 'AGENTS.md'),   // 后端 global.config/AGENTS.md
		path.join(xdg, 'opencode', 'AGENTS.md'),    // 后端 opencodeConfig/AGENTS.md（legacy）
		path.join(home, '.testagent', 'AGENTS.md'),
		path.join(home, '.claude', 'CLAUDE.md'),
	];
	if (workingDirectory) {
		const root = workingDirectory.fsPath;
		out.push(
			path.join(root, 'AGENTS.md'),
			path.join(root, 'CLAUDE.md'),
			path.join(root, 'CONTEXT.md'),          // 后端 FILES 含 CONTEXT.md（deprecated）
			path.join(root, '.testagent', 'AGENTS.md'),
			path.join(root, '.opencode', 'AGENTS.md'),
		);
	}
	return out;
}

/** 扫描存在的 rules 文件为 RuleCustomization（按解析路径去重）。 */
function scanOpenCodeRules(workingDirectory: URI | undefined): RuleCustomization[] {
	const seen = new Set<string>();
	const rules: RuleCustomization[] = [];
	for (const candidate of ruleCandidatePaths(workingDirectory)) {
		let isFile = false;
		try { isFile = fs.statSync(candidate).isFile(); } catch { continue; }
		if (!isFile) { continue; }
		const resolved = path.resolve(candidate);
		if (seen.has(resolved)) { continue; }
		seen.add(resolved);
		const uri = URI.file(candidate).toString(true);
		rules.push({
			type: CustomizationType.Rule,
			id: customizationId(uri),
			uri,
			name: path.basename(candidate),
			alwaysApply: true,
		});
	}
	return rules;
}

/**
 * 从 fork server 拉取 skills / commands / agents 清单并映射为协议 Customization。
 * 参考 Claude provider 的 discovery 输出形状；数据源换成 HTTP API，不做文件扫描。
 * 单个端点失败只省略对应容器；全失败返回空数组（调用方 TTL 缓存不存空结果以外的错误）。
 */
export async function fetchOpenCodeCustomizations(baseUrl: string, authHeader: string, workingDirectory: URI | undefined, logService: ILogService): Promise<readonly Customization[]> {
	// test-workbench_change start — 拉清单前先 POST /{agent,command,skill}/reload 让后端失效实例级
	// 缓存:管理面板 "New Agent/Skill/Prompt" 落盘新文件后,下一次 GET 清单即可见(配套后端
	// kilo_change_v2 的 reload 端点;失败忽略,退化为旧缓存)。
	const reloadHeaders: Record<string, string> = {};
	if (authHeader) { reloadHeaders['Authorization'] = authHeader; }
	if (workingDirectory) { reloadHeaders['x-opencode-directory'] = encodeURIComponent(workingDirectory.fsPath); }
	await Promise.allSettled(['/agent/reload', '/command/reload', '/skill/reload'].map(async p => {
		try {
			const resp = await fetch(`${baseUrl}${p}`, { method: 'POST', headers: reloadHeaders });
			await resp.body?.cancel();
		} catch (err) {
			logService.warn(`[OpenCode] customization reload ${p} failed: ${err}`);
		}
	}));
	// test-workbench_change end
	const [skills, commands, agents] = await Promise.all([
		fetchList<ISkillInfo>(baseUrl, '/skill', authHeader, workingDirectory, logService),
		fetchList<ICommandInfo>(baseUrl, '/command', authHeader, workingDirectory, logService),
		fetchList<IAgentInfo>(baseUrl, '/agent', authHeader, workingDirectory, logService),
	]);

	const result: Customization[] = [];

	// test-workbench_change start — 列表拉取成功(非 undefined)即上报容器,空清单也保留可写目录,
	// 让 "New Skill/Agent/Prompt" 始终有落点;单个端点失败才省略对应容器。
	if (skills) {
		const children: SkillCustomization[] = skills.map(s => {
			const uri = s.location ? URI.file(s.location).toString(true) : `${OPENCODE_SCHEME}:/skills/${s.name}`;
			return { type: CustomizationType.Skill, id: customizationId(uri), uri, name: s.name, description: s.description };
		});
		result.push(container('skills', CustomizationType.Skill, children, userConfigSubDir('skills', logService), logService));
	}

	if (commands) {
		// source==='skill' 的条目已由 /skill 容器呈现，去重；mcp prompt 命令保留
		const children: SkillCustomization[] = commands.filter(c => c.source !== 'skill').map(c => {
			const uri = `${OPENCODE_SCHEME}:/commands/${c.name}`;
			return { type: CustomizationType.Skill, id: customizationId(uri), uri, name: `/${c.name}`, description: c.description };
		});
		result.push(container('commands', CustomizationType.Skill, children, userConfigSubDir('commands', logService), logService));
	}

	if (agents) {
		// test-workbench_change start — 过滤后端 hidden 内部 agent(compaction/summary/title 等,
		// agent.ts 标 hidden:true):它们是 opencode 生命周期内部 agent,非用户可配置项,不应出现在
		// Agents 面板。此前仅设 disableUserInvocation 仍会展示(只是不可手动调用),不符"隐藏"语义。
		const children: AgentCustomization[] = agents.filter(a => !a.hidden).map(a => {
			const uri = `${OPENCODE_SCHEME}:/agents/${a.name}`;
			return {
				type: CustomizationType.Agent,
				id: customizationId(uri),
				uri,
				name: a.name,
				description: a.description,
				model: a.model?.providerID && a.model.modelID ? `${a.model.providerID}/${a.model.modelID}` : undefined,
			};
		});
		// test-workbench_change end
		// 后端扫描 {agent,agents}/**/*.md(config/agent.ts),用户级目录约定为单数 agent/
		result.push(container('agents', CustomizationType.Agent, children, userConfigSubDir('agent', logService), logService));
	}

	// test-workbench_change start — Instructions(Rule):opencode 后端无 rules HTTP 端点,
	// provider 侧磁盘扫描后端实际加载的 AGENTS.md 系列(对齐 Claude claudeRuleScan)。opencode 的
	// "instruction" 概念就是固定名 AGENTS.md(后端只读 AGENTS.md/CLAUDE.md + config.instructions,
	// 无 rules 目录自动加载),故不提供 "New Instruction"(新建自由命名文件后端不读,入口会误导):
	// 容器只读(writableDir=undefined),仅展示+点开编辑现有文件。不提供 enablement/删除。
	result.push(container('rules', CustomizationType.Rule, scanOpenCodeRules(workingDirectory), undefined, logService));
	// test-workbench_change end

	return result;
}

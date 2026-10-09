/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../../browser/media/sidebarActionButton.css';
import './media/customizationsToolbar.css';
import { VSBuffer } from '../../../../base/common/buffer.js'; // test-workbench_change — TestAgent 配置文件模板
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath } from '../../../../base/common/resources.js'; // test-workbench_change — TestAgent 配置路径
import { URI } from '../../../../base/common/uri.js'; // test-workbench_change
import { IFileService } from '../../../../platform/files/common/files.js'; // test-workbench_change
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js'; // test-workbench_change
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { AICustomizationManagementEditor } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagementEditor.js';
import { AICustomizationManagementEditorInput } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagementEditorInput.js';
import { IAICustomizationItemsModel, ItemsModelSection } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationItemsModel.js';
import { ILanguageModelToolsService } from '../../../../workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { AGENT_HOST_COPILOT_CLI_SESSION_TYPE, countEnabledCustomizationTools, IAgentHostToolSetEnablementService } from '../../../../workbench/contrib/chat/browser/agentSessions/agentHost/agentHostToolSetEnablementService.js';
import { Menus } from '../../../browser/menus.js';
import { agentIcon, instructionsIcon, mcpServerIcon, pluginIcon, skillIcon, hookIcon, toolsIcon } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationIcons.js';
import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../base/common/actions.js';
import { $, append } from '../../../../base/browser/dom.js';
import { autorun, IReader } from '../../../../base/common/observable.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { IPathService } from '../../../../workbench/services/path/common/pathService.js'; // test-workbench_change — 全局配置根目录
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'; // test-workbench_change — 项目配置根目录
import { AICustomizationManagementSection } from '../../../../workbench/contrib/chat/common/aiCustomizationWorkspaceService.js';
import { ChatContextKeys } from '../../../../workbench/contrib/chat/common/actions/chatContextKeys.js';
import { ICustomizationHarnessService } from '../../../../workbench/contrib/chat/common/customizationHarnessService.js';
import { ISession } from '../../../services/sessions/common/session.js';
import { ISessionsService } from '../../../services/sessions/browser/sessionsService.js';
import { SessionType } from '../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { IAICustomizationMcpServerCountService } from './customizationMcpServerCount.js';
import { OPEN_AI_CUSTOMIZATIONS_COMMAND_ID } from './customizationsConstants.js';

export interface ICustomizationItemConfig {
	readonly id: string;
	readonly label: string;
	readonly icon: ThemeIcon;
	readonly section?: typeof AICustomizationManagementSection[keyof typeof AICustomizationManagementSection];
	/** If set, count comes from `IAICustomizationItemsModel.getCount(modelSection)`. */
	readonly modelSection?: ItemsModelSection;
	readonly isMcp?: boolean;
	readonly isPlugins?: boolean;
	readonly isTools?: boolean;
	/** Additional `when` clause beyond the standard harness-visibility gate. */
	readonly when?: ContextKeyExpression;
}

/**
 * Per-section context key indicating whether the active harness exposes
 * the section in the sidebar customizations toolbar. Driven by
 * `IHarnessDescriptor.hiddenSections` and consumed via the menu `when`
 * clause registered alongside each customization action.
 */
function customizationSectionVisibleKey(section: string): string {
	return `sessionsCustomizationSectionVisible.${section}`;
}

const CUSTOMIZATION_OVERVIEW_ITEM: ICustomizationItemConfig = {
	id: OPEN_AI_CUSTOMIZATIONS_COMMAND_ID,
	label: localize('overview', "Overview"),
	icon: Codicon.home,
};

export function readCustomizationCount(
	config: ICustomizationItemConfig,
	reader: IReader,
	itemsModel: IAICustomizationItemsModel,
	mcpServerCountService: IAICustomizationMcpServerCountService,
	toolsService: ILanguageModelToolsService,
	toolEnablementService: IAgentHostToolSetEnablementService,
): number {
	if (config.modelSection) {
		return itemsModel.getCount(config.modelSection).read(reader);
	}
	if (config.isMcp) {
		return mcpServerCountService.count.read(reader);
	}
	if (config.isPlugins) {
		return itemsModel.getPluginCount().read(reader);
	}
	if (config.isTools) {
		const state = toolEnablementService.observe(AGENT_HOST_COPILOT_CLI_SESSION_TYPE).read(reader);
		return countEnabledCustomizationTools(toolsService.toolSets.read(reader), state, reader);
	}
	return 0;
}

export const CUSTOMIZATION_ITEMS: ICustomizationItemConfig[] = [
	{
		id: 'sessions.customization.plugins',
		label: localize('plugins', "Plugins"),
		icon: pluginIcon,
		section: AICustomizationManagementSection.Plugins,
		isPlugins: true,
	},
	{
		id: 'sessions.customization.mcpServers',
		label: localize('mcpServers', "MCP Servers"),
		icon: mcpServerIcon,
		section: AICustomizationManagementSection.McpServers,
		isMcp: true,
	},
	{
		id: 'sessions.customization.skills',
		label: localize('skills', "Skills"),
		icon: skillIcon,
		section: AICustomizationManagementSection.Skills,
		modelSection: AICustomizationManagementSection.Skills,
	},
	{
		id: 'sessions.customization.instructions',
		label: localize('instructions', "Instructions"),
		icon: instructionsIcon,
		section: AICustomizationManagementSection.Instructions,
		modelSection: AICustomizationManagementSection.Instructions,
	},
	{
		id: 'sessions.customization.agents',
		label: localize('agents', "Agents"),
		icon: agentIcon,
		section: AICustomizationManagementSection.Agents,
		modelSection: AICustomizationManagementSection.Agents,
	},
	{
		id: 'sessions.customization.hooks',
		label: localize('hooks', "Hooks"),
		icon: hookIcon,
		section: AICustomizationManagementSection.Hooks,
		modelSection: AICustomizationManagementSection.Hooks,
	},
	{
		id: 'sessions.customization.tools',
		label: localize('tools', "Tools"),
		icon: toolsIcon,
		section: AICustomizationManagementSection.Tools,
		isTools: true,
	},
	{
		id: 'sessions.customization.harnessSettings',
		label: localize('harnessSettings', "Codex"),
		icon: Codicon.openai,
		section: AICustomizationManagementSection.HarnessSettings,
	},
];

// test-workbench_change start - TestAgent 配置文件入口:项目级/全局级
// 对齐 kilo-vscode Settings 的"项目配置/全局配置"(openConfigFile):点击直接打开
// (或创建) testagent 后端实际读取的配置文件,而不进 customizations 管理编辑器。
export const TESTAGENT_PROJECT_CONFIG_ID = 'sessions.testagent.openProjectConfig';
export const TESTAGENT_GLOBAL_CONFIG_ID = 'sessions.testagent.openGlobalConfig';

const TESTAGENT_CONFIG_ITEMS: ICustomizationItemConfig[] = [
	{
		id: TESTAGENT_PROJECT_CONFIG_ID,
		label: localize('testagent.projectConfig', "项目配置"),
		icon: Codicon.folderOpened,
	},
	{
		id: TESTAGENT_GLOBAL_CONFIG_ID,
		label: localize('testagent.globalConfig', "全局配置"),
		icon: Codicon.globe,
	},
];

/** 新建配置文件时的默认模板(与 kilo-vscode handleOpenConfigFile 保持一致)。 */
const TESTAGENT_CONFIG_TEMPLATE = `{
  // TestAgent 配置
  // 更多配置选项请参考: https://opencode.ai/docs/config/
  "$schema": "https://opencode.ai/config.json"
}
`;

/** 全局配置候选(与后端 config.ts loadGlobal 的加载顺序一致,高优先级在前)。 */
const TESTAGENT_GLOBAL_CONFIG_CANDIDATES = ['testagent.jsonc', 'testagent.json', 'opencode.jsonc', 'opencode.json', 'config.json'];

async function openOrCreateTestAgentConfig(accessor: ServicesAccessor, scope: 'local' | 'global'): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const fileService = accessor.get(IFileService);
	const notificationService = accessor.get(INotificationService);

	if (scope === 'local') {
		const folders = accessor.get(IWorkspaceContextService).getWorkspace().folders;
		if (folders.length === 0) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('testagent.openConfig.noWorkspace', "打开工作区文件夹以编辑项目 TestAgent 配置文件"),
			});
			return;
		}
		const configFile = joinPath(folders[0].uri, '.testagent', 'testagent.jsonc');
		await openOrCreateConfigFile(editorService, fileService, configFile);
		return;
	}

	// Global scope: 与后端 global.ts 约定一致($XDG_CONFIG_HOME ?? ~/.config + testagent)。
	const userHome = await accessor.get(IPathService).userHome({ preferLocal: true });
	const configDir = joinPath(userHome, '.config', 'testagent');
	for (const name of TESTAGENT_GLOBAL_CONFIG_CANDIDATES) {
		const candidate = joinPath(configDir, name);
		if (await fileService.exists(candidate)) {
			await editorService.openEditor({ resource: candidate, options: { pinned: true } });
			return;
		}
	}
	await openOrCreateConfigFile(editorService, fileService, joinPath(configDir, 'testagent.jsonc'));
}

async function openOrCreateConfigFile(editorService: IEditorService, fileService: IFileService, file: URI): Promise<void> {
	if (!(await fileService.exists(file))) {
		await fileService.createFolder(dirname(file));
		await fileService.createFile(file, VSBuffer.fromString(TESTAGENT_CONFIG_TEMPLATE));
	}
	await editorService.openEditor({ resource: file, options: { pinned: true } });
}
// test-workbench_change end

async function openCustomizationOverviewPage(editorService: IEditorService, harnessService: ICustomizationHarnessService, sessionsService: ISessionsService): Promise<void> {
	const session = sessionsService.activeSession.get();
	if (session) {
		harnessService.setActiveSession(session.resource);
	}

	const input = AICustomizationManagementEditorInput.getOrCreate();
	input.setTargetLabels(harnessService.getActiveDescriptor().label, session?.workspace.get()?.folders[0]?.name);
	const pane = await editorService.openEditor(input, { pinned: true });
	if (pane instanceof AICustomizationManagementEditor) {
		pane.showWelcomePage();
	}
}

async function openCustomizationSectionPage(editorService: IEditorService, harnessService: ICustomizationHarnessService, sessionsService: ISessionsService, section: typeof AICustomizationManagementSection[keyof typeof AICustomizationManagementSection]): Promise<void> {
	const session = sessionsService.activeSession.get();
	if (session) {
		harnessService.setActiveSession(session.resource);
	}

	const input = AICustomizationManagementEditorInput.getOrCreate();
	input.setTargetLabels(harnessService.getActiveDescriptor().label, session?.workspace.get()?.folders[0]?.name);
	const pane = await editorService.openEditor(input, { pinned: true });
	if (pane instanceof AICustomizationManagementEditor) {
		pane.selectSectionById(section);
	}
}

/**
 * Custom ActionViewItem for each customization link in the toolbar.
 * Renders icon + label + a single count badge driven by the same
 * observables that feed the customizations editor — so the badge always
 * matches the editor's count exactly.
 */
export class CustomizationLinkViewItem extends BaseActionViewItem {

	private readonly _viewItemDisposables: DisposableStore;
	private _button: Button | undefined;
	private _countContainer: HTMLElement | undefined;

	constructor(
		action: IAction,
		options: IBaseActionViewItemOptions,
		private readonly _config: ICustomizationItemConfig,
		@IAICustomizationItemsModel private readonly _itemsModel: IAICustomizationItemsModel,
		@IAICustomizationMcpServerCountService private readonly _mcpServerCountService: IAICustomizationMcpServerCountService,
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
		@IAgentHostToolSetEnablementService private readonly _toolEnablementService: IAgentHostToolSetEnablementService,
	) {
		super(undefined, action, options);
		this._viewItemDisposables = this._register(new DisposableStore());
	}

	protected override getTooltip(): string | undefined {
		return undefined;
	}

	override render(container: HTMLElement): void {
		this._viewItemDisposables.clear();
		this.element = container;
		container.classList.add('customization-link-widget', 'sidebar-action');

		// Button (left) - uses supportIcons to render codicon in label
		const buttonContainer = append(container, $('.customization-link-button-container'));
		this._button = this._viewItemDisposables.add(new Button(buttonContainer, {
			...defaultButtonStyles,
			secondary: true,
			title: false,
			supportIcons: true,
			buttonSecondaryBackground: 'transparent',
			buttonSecondaryHoverBackground: undefined,
			buttonSecondaryForeground: undefined,
			buttonSecondaryBorder: undefined,
		}));
		this._button.element.classList.add('customization-link-button', 'sidebar-action-button');
		this._button.label = `$(${this._config.icon.id}) ${this._config.label}`;
		this.updateEnabled();

		this._viewItemDisposables.add(this._button.onDidClick(() => {
			this.actionRunner.run(this._action, this._context);
		}));

		// Count container (inside button, floating right)
		this._countContainer = append(this._button.element, $('span.customization-link-counts'));

		this._viewItemDisposables.add(autorun(reader => {
			const count = readCustomizationCount(this._config, reader, this._itemsModel, this._mcpServerCountService, this._toolsService, this._toolEnablementService);
			if (this._countContainer) {
				this._renderTotalCount(this._countContainer, count);
			}
		}));
	}

	override focus(): void {
		if (this._button) {
			this._button.element.tabIndex = 0;
			this._button.focus();
		}
	}

	override blur(): void {
		if (this._button) {
			this._button.element.blur();
			this._button.element.tabIndex = -1;
		}
	}

	override setFocusable(focusable: boolean): void {
		if (this.element) {
			this.element.tabIndex = -1;
		}
		if (this._button) {
			this._button.element.tabIndex = focusable ? 0 : -1;
		}
	}

	protected override updateEnabled(): void {
		if (this._button) {
			this._button.enabled = this._action.enabled;
		}
	}

	private _renderTotalCount(container: HTMLElement, count: number): void {
		container.textContent = '';
		container.classList.toggle('hidden', count === 0);
		if (count > 0) {
			const badge = append(container, $('span.source-count-badge'));
			const num = append(badge, $('span.source-count-num'));
			num.textContent = `${count}`;
		}
	}
}

// --- Register actions and view items --- //

export class CustomizationsToolbarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessionsCustomizationsToolbar';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICustomizationHarnessService harnessService: ICustomizationHarnessService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		// Per-section visibility context keys, kept in sync with the active
		// harness's `hiddenSections`. Each customization action's menu entry
		// is gated on its key so that harnesses (e.g. Claude, AHP) which
		// don't support a customization type don't surface its row.
		const visibilityKeys = new Map<string, IContextKey<boolean>>();
		for (const config of CUSTOMIZATION_ITEMS) {
			if (!config.section) {
				continue;
			}
			const key = new RawContextKey<boolean>(customizationSectionVisibleKey(config.section), true).bindTo(contextKeyService);
			visibilityKeys.set(config.section, key);
		}
		this._register(autorun(reader => {
			const activeHarness = harnessService.activeHarness.read(reader);
			harnessService.availableHarnesses.read(reader);
			const descriptor = harnessService.getActiveDescriptor();
			const hidden = new Set(descriptor.hiddenSections ?? []);
			for (const config of CUSTOMIZATION_ITEMS) {
				if (!config.section) {
					continue;
				}
				const supported = config.section !== AICustomizationManagementSection.HarnessSettings || activeHarness === SessionType.AgentHostCodex;
				visibilityKeys.get(config.section)!.set(!hidden.has(config.section) && supported);
			}
		}));

		this._register(actionViewItemService.register(Menus.SidebarCustomizations, CUSTOMIZATION_OVERVIEW_ITEM.id, (action, options) => {
			return instantiationService.createInstance(CustomizationLinkViewItem, action, options, CUSTOMIZATION_OVERVIEW_ITEM);
		}, undefined));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: CUSTOMIZATION_OVERVIEW_ITEM.id,
					title: CUSTOMIZATION_OVERVIEW_ITEM.label,
					precondition: ChatContextKeys.enabled,
					menu: {
						id: Menus.SidebarCustomizations,
						group: 'navigation',
						order: 0,
						when: ChatContextKeys.enabled,
					}
				});
			}
			async run(accessor: ServicesAccessor): Promise<void> {
				await openCustomizationOverviewPage(
					accessor.get(IEditorService),
					accessor.get(ICustomizationHarnessService),
					accessor.get(ISessionsService),
				);
			}
		}));

		for (const [index, config] of CUSTOMIZATION_ITEMS.entries()) {
			if (!config.section) {
				continue;
			}
			const section = config.section;
			// Register the custom ActionViewItem for this action
			this._register(actionViewItemService.register(Menus.SidebarCustomizations, config.id, (action, options) => {
				return instantiationService.createInstance(CustomizationLinkViewItem, action, options, config);
			}, undefined));

			const sectionVisibleWhen = ContextKeyExpr.has(customizationSectionVisibleKey(section));
			const combinedWhen = config.when
				? ContextKeyExpr.and(ChatContextKeys.enabled, sectionVisibleWhen, config.when)
				: ContextKeyExpr.and(ChatContextKeys.enabled, sectionVisibleWhen);

			// Register the action with menu item
			this._register(registerAction2(class extends Action2 {
				constructor() {
					super({
						id: config.id,
						title: config.label,
						menu: {
							id: Menus.SidebarCustomizations,
							group: 'navigation',
							order: index + 1,
							when: combinedWhen,
						}
					});
				}
				async run(accessor: ServicesAccessor): Promise<void> {
					const editorService = accessor.get(IEditorService);
					const harnessService = accessor.get(ICustomizationHarnessService);
					const sessionsService = accessor.get(ISessionsService);
					await openCustomizationSectionPage(editorService, harnessService, sessionsService, section);
				}
			}));
		}

		// test-workbench_change start - TestAgent 配置文件入口
		// 项目级/全局级两个配置按钮,始终显示(与 active harness 无关)。
		for (const [index, config] of TESTAGENT_CONFIG_ITEMS.entries()) {
			this._register(actionViewItemService.register(Menus.SidebarCustomizations, config.id, (action, options) => {
				return instantiationService.createInstance(CustomizationLinkViewItem, action, options, config);
			}, undefined));

			const scope = config.id === TESTAGENT_PROJECT_CONFIG_ID ? 'local' : 'global';
			this._register(registerAction2(class extends Action2 {
				constructor() {
					super({
						id: config.id,
						title: config.label,
						icon: config.icon,
						menu: {
							id: Menus.SidebarCustomizations,
							group: 'navigation',
							order: 20 + index,
							when: ChatContextKeys.enabled,
						}
					});
				}
				async run(accessor: ServicesAccessor): Promise<void> {
					await openOrCreateTestAgentConfig(accessor, scope);
				}
			}));
		}
		// test-workbench_change end
	}
}

registerWorkbenchContribution2(CustomizationsToolbarContribution.ID, CustomizationsToolbarContribution, WorkbenchPhase.AfterRestored);

/**
 * Returns the harness id that matches a given session, or `undefined` if no
 * harness is registered for it.
 *
 * The session's `resource.scheme` is the per-host harness id (e.g. local AHP
 * uses `agent-host-${provider}` and remote AHP uses `remote-${authority}-${provider}`),
 * while {@link ISession.sessionType} is the agent provider name shared across
 * hosts (e.g. `copilotcli`). Lookup therefore prefers the resource scheme so
 * that an AHP remote session selects its remote harness rather than the local
 * harness with the same `sessionType`. The `sessionType` is kept as a fallback
 * for harnesses whose id matches it directly.
 */
export function findHarnessIdForSession(session: ISession | undefined, harnessService: ICustomizationHarnessService): string | undefined {
	if (!session) {
		return undefined;
	}
	const schemeId = session.resource.scheme;
	if (harnessService.findHarnessById(schemeId)) {
		return schemeId;
	}
	if (harnessService.findHarnessById(session.sessionType)) {
		return session.sessionType;
	}
	return undefined;
}

/**
 * Keeps the active customization harness in sync with the currently active
 * session. This drives the customizations sidebar (counts, filtering) and the
 * customizations editor so they reflect the harness that matches the session
 * the user is interacting with.
 *
 * This covers two cases identically:
 *  - opening / navigating into an existing session
 *  - selecting "New session in {workspace}" (which sets a pending active
 *    session before the user has sent the first request)
 */
export class ActiveSessionHarnessSyncContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sessionsActiveHarnessSync';

	constructor(
		@ISessionsService sessionsService: ISessionsService,
		@ICustomizationHarnessService harnessService: ICustomizationHarnessService,
	) {
		super();

		this._register(autorun(reader => {
			const session = sessionsService.activeSession.read(reader);
			if (!session) {
				return;
			}
			// Re-read available harnesses so we re-run when an external harness
			// (e.g. agent host, CLI) registers asynchronously after the session
			// has already been selected.
			harnessService.availableHarnesses.read(reader);
			harnessService.setActiveSession(session.resource);
		}));
	}
}

registerWorkbenchContribution2(ActiveSessionHarnessSyncContribution.ID, ActiveSessionHarnessSyncContribution, WorkbenchPhase.AfterRestored);

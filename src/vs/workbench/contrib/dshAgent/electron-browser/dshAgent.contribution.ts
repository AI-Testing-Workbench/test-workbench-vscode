/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IExplorerService } from '../../files/browser/files.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { URI } from '../../../../base/common/uri.js';
import { ipcRenderer } from '../../../../base/parts/sandbox/electron-browser/globals.js';
import {
	DSH_AGENT_MAIN_CHANNEL,
	DSH_AGENT_MAX_CONTEXT_TEXT_LENGTH,
	DshAgentRendererChannel,
	IDshAgentContext,
	IDshAgentOpenDiffRequest,
	IDshAgentOpenFileRequest,
	validateOpenDiffRequest,
	validateOpenFileRequest
} from '../../../../platform/dshAgent/common/dshAgent.js';

const OPEN_AGENT_COMMAND_ID = 'dsh.agent.openWindow';

/**
 * Workbench side of the Agent bridge: publishes IDE context, opens files
 * requested by the Agent, and owns the user-facing command.
 */
class DshAgentBridgeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.dshAgentBridge';

	private channel: ReturnType<IMainProcessService['getChannel']> | undefined;
	private readonly contextScheduler = this._register(new RunOnceScheduler(() => this.publishContext(), 50));
	private readonly selectionListener = this._register(new MutableDisposable());

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustService: IWorkspaceTrustManagementService,
		@IEditorService private readonly editorService: IEditorService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IThemeService private readonly themeService: IThemeService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.channel = mainProcessService.getChannel(DSH_AGENT_MAIN_CHANNEL);

		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.bindSelection();
			this.scheduleContext();
		}));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.scheduleContext()));
		this._register(this.workspaceTrustService.onDidChangeTrust(() => this.scheduleContext()));
		this._register(this.themeService.onDidColorThemeChange(() => this.scheduleContext()));
		this.listen(DshAgentRendererChannel.OpenFile, (_event, request) => {
			const validated = validateOpenFileRequest(request);
			if (validated) {
				void this.openFile(validated);
			}
		});
		this.listen(DshAgentRendererChannel.OpenDiff, (_event, request) => {
			const validated = validateOpenDiffRequest(request);
			if (validated) {
				void this.openDiff(validated);
			}
		});
		this.listen('vscode:dshAgentRevealInExplorer', (_event, path) => {
			if (typeof path === 'string' && path.length > 0 && path.length <= 4096) {
				void this.explorerService.select(URI.file(path), true).catch(() => undefined);
			}
		});

		this.bindSelection();
		this.scheduleContext();
	}

	private listen(channel: string, handler: (event: unknown, ...args: unknown[]) => void): void {
		ipcRenderer.on(channel, handler);
		this._register(toDisposable(() => ipcRenderer.removeListener(channel, handler)));
	}

	private bindSelection(): void {
		const editor = this.codeEditorService.getActiveCodeEditor();
		if (!editor) {
			this.selectionListener.clear();
			return;
		}
		this.selectionListener.value = editor.onDidChangeCursorSelection(() => this.scheduleContext());
	}

	private scheduleContext(): void {
		if (!this.contextScheduler.isScheduled()) {
			this.contextScheduler.schedule();
		}
	}

	private publishContext(): void {
		if (!this.channel) {
			return;
		}
		// `IChannel.call` takes one optional argument; multi-argument targets
		// receive an array. A bare object would be dropped by the proxy.
		this.channel.call('updateContext', [this.createContext()]).catch(error => {
			this.logService.trace('[dshAgent] context update failed', toErrorMessage(error));
		});
	}

	private createContext(): unknown {
		const folders = this.workspaceContextService.getWorkspace().folders
			.filter(folder => folder.uri.scheme === 'file')
			.map(folder => folder.uri.fsPath)
			.slice(0, 32);
		const activeResource = this.editorService.activeEditor?.resource;
		const activeFile = activeResource?.scheme === 'file' ? activeResource.fsPath : undefined;
		const codeEditor = this.codeEditorService.getActiveCodeEditor();
		const model = codeEditor?.getModel();
		let context: IDshAgentContext = {
			revision: 0,
			trusted: this.workspaceTrustService.isWorkspaceTrusted(),
			workspaceFolders: folders,
			theme: this.theme(),
			locale: navigator.language
		};
		if (activeFile && model && activeResource?.toString() === model.uri.toString()) {
			const selection = codeEditor?.getSelection();
			context = {
				...context,
				activeFile,
				languageId: model.getLanguageId(),
				...(selection && !selection.isEmpty() ? {
					selection: {
						path: activeFile,
						startLine: selection.startLineNumber,
						startColumn: selection.startColumn,
						endLine: selection.endLineNumber,
						endColumn: selection.endColumn,
						text: model.getValueInRange(selection).slice(0, DSH_AGENT_MAX_CONTEXT_TEXT_LENGTH)
					}
				} : {})
			};
		} else if (activeFile) {
			context = { ...context, activeFile };
		}
		return context;
	}

	private theme(): IDshAgentContext['theme'] {
		switch (this.themeService.getColorTheme().type) {
			case ColorScheme.LIGHT: return 'light';
			case ColorScheme.HIGH_CONTRAST_DARK: return 'hc';
			case ColorScheme.HIGH_CONTRAST_LIGHT: return 'hc-light';
			default: return 'dark';
		}
	}

	private async openFile(request: IDshAgentOpenFileRequest): Promise<void> {
		if (!await this.exists(request.path)) {
			return;
		}
		await this.editorService.openEditor({
			resource: URI.file(request.path),
			options: {
				preserveFocus: request.preserveFocus === true,
				...(request.line !== undefined ? {
					selection: {
						startLineNumber: request.line,
						startColumn: request.column ?? 1
					}
				} : {})
			}
		});
	}

	private async openDiff(request: IDshAgentOpenDiffRequest): Promise<void> {
		if (!request.originalPath) {
			await this.openFile(request);
			return;
		}
		if (!await this.exists(request.path) || !await this.exists(request.originalPath)) {
			return;
		}
		await this.editorService.openEditor({
			original: { resource: URI.file(request.originalPath) },
			modified: { resource: URI.file(request.path) },
			options: { preserveFocus: request.preserveFocus === true }
		});
	}

	private async exists(path: string): Promise<boolean> {
		try {
			await this.fileService.stat(URI.file(path));
			return true;
		} catch {
			return false;
		}
	}
}

class OpenDshAgentWindowAction extends Action2 {

	constructor() {
		super({
			id: OPEN_AGENT_COMMAND_ID,
			title: localize2('dshAgent.open', "Open dsh Agent Window"),
			category: localize2('dshAgent.category', "dsh Agent"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyA,
				weight: KeybindingWeight.WorkbenchContrib + 10
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const mainProcessService = accessor.get(IMainProcessService);
		const notificationService = accessor.get(INotificationService);
		try {
			await mainProcessService.getChannel(DSH_AGENT_MAIN_CHANNEL).call('openWindow');
		} catch (error) {
			notificationService.error(localize('dshAgent.openFailed', "Could not open the dsh Agent window: {0}", toErrorMessage(error)));
		}
	}
}

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	command: { id: OPEN_AGENT_COMMAND_ID, title: localize2('dshAgent.open.short', "dsh Agent") },
	group: '3_agent'
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'dshAgent',
	title: localize('dshAgent.configurationTitle', "dsh Agent"),
	type: 'object',
	properties: {
		'dsh.agentWindow.enabled': {
			type: 'boolean',
			default: true,
			description: localize('dshAgent.enabled', "Enable the dsh Agent window. A release can also disable it remotely."),
			scope: ConfigurationScope.APPLICATION
		},
		'dsh.agentWindow.requireTrustedWorkspace': {
			type: 'boolean',
			default: true,
			description: localize('dshAgent.requireTrust', "Only start the dsh Agent Host in a trusted workspace."),
			scope: ConfigurationScope.APPLICATION
		},
		'dsh.agentWindow.autoRestart': {
			type: 'boolean',
			default: true,
			description: localize('dshAgent.autoRestart', "Restart the dsh Agent Host after an unexpected exit."),
			scope: ConfigurationScope.APPLICATION
		},
		'dsh.agentWindow.profile': {
			type: 'string',
			default: 'web',
			description: localize('dshAgent.profile', "dsh profile booted by the Agent window."),
			scope: ConfigurationScope.APPLICATION
		},
		'dsh.agentWindow.nodePath': {
			type: 'string',
			default: '',
			description: localize('dshAgent.nodePath', "Absolute path to the Node 22.22.1 executable used for the Agent Host. Leave empty to use the bundled runtime."),
			scope: ConfigurationScope.MACHINE
		},
		'dsh.agentWindow.dshEntry': {
			type: 'string',
			default: '',
			description: localize('dshAgent.dshEntry', "Absolute path to `@deepseek-ai/dsh/lib/bin.js`. Leave empty to use the bundled runtime."),
			scope: ConfigurationScope.MACHINE
		},
		'dsh.agentWindow.dshHome': {
			type: 'string',
			default: '',
			description: localize('dshAgent.dshHome', "Isolated DSH_HOME. Defaults to ~/.tscode-dsh."),
			scope: ConfigurationScope.MACHINE
		}
	}
});

registerAction2(OpenDshAgentWindowAction);
registerWorkbenchContribution2(DshAgentBridgeContribution.ID, DshAgentBridgeContribution, WorkbenchPhase.AfterRestored);

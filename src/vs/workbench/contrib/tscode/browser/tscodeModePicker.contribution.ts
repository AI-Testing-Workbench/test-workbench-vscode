/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file
// TSCode first-run mode picker (首次启动模式选择弹窗)
//
// Shown once per install (per application storage), the picker lets the user
// choose between the editor mode and the Agents Window mode. Choosing "Agent"
// hands the current window off to the Agents Window; the choice is not stored,
// so subsequent launches keep the existing "reopen the last used window" behavior.

import './media/tscodeModePicker.css'; // test-workbench_change

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { AgentsWindowOpenSource } from '../../../../platform/window/common/window.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IsAuxiliaryWindowContext } from '../../../common/contextkeys.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { OPEN_AGENTS_WINDOW_COMMAND_ID } from '../../chat/common/constants.js';

const MODE_PICKER_SHOWN_STORAGE_KEY = 'tscode-mode-picker.shown';

class TscodeModePickerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.tscodeModePicker';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Never show in auxiliary windows; the picker belongs to the main window only.
		if (IsAuxiliaryWindowContext.getValue(this.contextKeyService)) {
			return;
		}

		// Only ever show the picker once per install.
		if (this.storageService.getBoolean(MODE_PICKER_SHOWN_STORAGE_KEY, StorageScope.APPLICATION, false)) {
			return;
		}

		this.showModePicker();
	}

	private showModePicker(): void {
		// Record that the picker has been shown before building the UI so a
		// window reload (e.g. the Agents Window handoff) cannot show it again.
		this.storageService.store(MODE_PICKER_SHOWN_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);

		const store = new DisposableStore();
		this._register(store);

		const overlay = $('div.tscode-mode-picker-overlay');
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		// allow-any-unicode-next-line
		overlay.setAttribute('aria-label', localize('tscode.modePicker.title', "选择进入模式"));
		store.add(toDisposable(() => overlay.remove()));

		const dialog = append(overlay, $('div.tscode-mode-picker-dialog'));
		// allow-any-unicode-next-line
		append(dialog, $('div.tscode-mode-picker-title', undefined, localize('tscode.modePicker.title', "选择进入模式")));
		// allow-any-unicode-next-line
		append(dialog, $('div.tscode-mode-picker-subtitle', undefined, localize('tscode.modePicker.subtitle', "请选择要使用的界面模式，进入后仍可随时切换。")));

		const options = append(dialog, $('div.tscode-mode-picker-options'));
		// allow-any-unicode-next-line
		const editorOption = this.createOption(options, 'codicon-code', 'IDE', localize('tscode.modePicker.editorDescription', "编辑器模式"), 'letterpress');
		// allow-any-unicode-next-line
		const agentOption = this.createOption(options, 'codicon-sparkle', 'Agent', localize('tscode.modePicker.agentDescription', "Agent Window 模式"), 'sessions');

		store.add(addDisposableListener(editorOption, 'click', () => store.dispose()));
		store.add(addDisposableListener(agentOption, 'click', () => {
			store.dispose();
			void this.openAgentsWindow();
		}));

		// Append inside the workbench container so the modal picks up the
		// `.monaco-workbench`-scoped theme variables and follows the active theme.
		this.layoutService.getContainer(mainWindow).appendChild(overlay);
		editorOption.focus();
	}

	private createOption(parent: HTMLElement, iconClass: string, label: string, description: string, background?: 'letterpress' | 'sessions'): HTMLButtonElement {
		const option = append(parent, $<HTMLButtonElement>('button.tscode-mode-picker-option', { type: 'button' }));
		if (background) {
			// test-workbench_change - empty-state icon rendered as a background
			option.classList.add(`tscode-mode-picker-option--${background}`);
			append(option, $('div.tscode-mode-picker-option-bg'));
		}
		const content = append(option, $('div.tscode-mode-picker-option-content'));
		const icon = append(content, $('span.tscode-mode-picker-option-icon'));
		icon.classList.add('codicon', iconClass);
		append(content, $('span.tscode-mode-picker-option-label', undefined, label));
		append(content, $('span.tscode-mode-picker-option-desc', undefined, description));
		return option;
	}

	private async openAgentsWindow(): Promise<void> {
		try {
			await this.commandService.executeCommand(OPEN_AGENTS_WINDOW_COMMAND_ID, {
				reuseWindow: true,
				source: AgentsWindowOpenSource.CommandPalette,
			});
		} catch (err) {
			this.logService.warn('[TscodeModePicker] failed to open Agents Window', err);
		}
	}
}

registerWorkbenchContribution2(TscodeModePickerContribution.ID, TscodeModePickerContribution, WorkbenchPhase.AfterRestored); // test-workbench_change

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, BrowserWindowConstructorOptions, WebContents } from 'electron';
import { Event } from '../../../base/common/event.js';
import { toDisposable } from '../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IStateService } from '../../state/node/state.js';
import { hasNativeTitlebar, TitlebarStyle } from '../../window/common/window.js';
import { IBaseWindow, WindowMode } from '../../window/electron-main/window.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import { BaseWindow } from '../../windows/electron-main/windowImpl.js';

export interface IAuxiliaryWindow extends IBaseWindow {
	readonly parentId: number;
}

export class AuxiliaryWindow extends BaseWindow implements IAuxiliaryWindow {

	readonly id: number;
	parentId = -1;

	override get win() {
		if (!super.win) {
			this.tryClaimWindow();
		}

		return super.win;
	}

	private stateApplied = false;

	constructor(
		private readonly webContents: WebContents,
		private readonly windowOptions: BrowserWindowConstructorOptions | undefined,
		private readonly disableMaximize: boolean,
		private readonly hideOnClose: boolean, // test-workbench_change
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@ILogService logService: ILogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStateService stateService: IStateService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService // test-workbench_change
	) {
		super(configurationService, stateService, environmentMainService, logService);

		this.id = this.webContents.id;

		// Try to claim window
		this.tryClaimWindow();
	}

	tryClaimWindow(options?: BrowserWindowConstructorOptions): void {
		if (this._store.isDisposed || this.webContents.isDestroyed()) {
			return; // already disposed
		}

		const effectiveOptions = options ?? this.windowOptions;

		this.doTryClaimWindow(effectiveOptions);

		if (effectiveOptions && !this.stateApplied) {
			this.stateApplied = true;

			this.applyState({
				x: effectiveOptions.x,
				y: effectiveOptions.y,
				width: effectiveOptions.width,
				height: effectiveOptions.height,
				// We currently do not support restoring fullscreen state for auxiliary
				// windows because we do not get hold of the original `features` string
				// that contains that info in `window-fullscreen`. However, we can
				// probe the `options.show` value for whether the window should be maximized
				// or not because we never show maximized windows initially to reduce flicker.
				mode: effectiveOptions.show === false ? WindowMode.Maximized : WindowMode.Normal
			});
		}
	}

	private doTryClaimWindow(options?: BrowserWindowConstructorOptions): void {
		if (this._win) {
			return; // already claimed
		}

		const window = BrowserWindow.fromWebContents(this.webContents);
		if (window) {
			this.logService.trace('[aux window] Claimed browser window instance');

			// Remember
			this.setWin(window, options);

			// Disable Menu
			window.setMenu(null);
			if ((isWindows || isLinux) && hasNativeTitlebar(this.configurationService, options?.titleBarStyle === 'hidden' ? TitlebarStyle.CUSTOM : undefined /* unknown */)) {
				window.setAutoHideMenuBar(true); // Fix for https://github.com/microsoft/vscode/issues/200615
			}

			// Lifecycle
			this.lifecycleMainService.registerAuxWindow(this);

			// Allow frameless windows to size down to their content
			if (options?.frame === false) {
				window.setMinimumSize(1, 1);

				// Hide macOS traffic light buttons
				if (isMacintosh) {
					window.setWindowButtonVisibility(false);
				}
			}

			// Disable resizing for non-resizable windows
			if (options?.resizable === false) {
				window.setResizable(false);
			}

			if (this.disableMaximize) {
				this._register(Event.fromNodeEventEmitter(window, 'maximize')(() => window.unmaximize()));
			}

			// test-workbench_change start - the desktop-pet conversation popup must
			// not be destroyed while its owner workbench window is minimized:
			// destroying a `window.open` popup makes Electron/Chromium focus the
			// opener, which restores (reopens) the minimized owner. Hide instead;
			// the window is really closed once quit is requested or its owner closes.
			if (this.hideOnClose) {
				const onClose = (e: Electron.Event) => {
					if (this.lifecycleMainService.quitRequested) {
						return; // allow close while quitting
					}

					const owner = this.parentId !== -1 ? this.windowsMainService.getWindowById(this.parentId) : undefined;
					const ownerWin = owner?.win;
					if (!ownerWin || ownerWin.isDestroyed()) {
						return; // allow close when the owner is gone
					}

					if (ownerWin.isMinimized()) {
						e.preventDefault();
						window.hide();
					}
				};
				window.on('close', onClose);
				this._register(toDisposable(() => window.removeListener('close', onClose)));
			}
			// test-workbench_change end
		}
	}

	matches(webContents: WebContents): boolean {
		return this.webContents.id === webContents.id;
	}
}

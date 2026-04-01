// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { IModeSwitchService, WorkbenchMode } from '../common/modeSwitchService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchLayoutService, Parts } from '../../layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js'; // test-workbench_change

export class ModeSwitchService extends Disposable implements IModeSwitchService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMode = this._register(new Emitter<WorkbenchMode>());
	readonly onDidChangeMode = this._onDidChangeMode.event;

	private _currentMode: WorkbenchMode;
	private static readonly STORAGE_KEY = 'workbench.mode.state';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService // test-workbench_change
	) {
		super();

		// test-workbench_change start - error handling for initialization
		try {
			// Load saved mode or default to IDE mode
			const savedMode = this.storageService.get(ModeSwitchService.STORAGE_KEY, StorageScope.PROFILE);
			this._currentMode = this.isValidMode(savedMode) ? savedMode as WorkbenchMode : WorkbenchMode.IDE;

			this.logService.info(`[ModeSwitchService] Initialized with mode: ${this._currentMode}`);

			// Apply the initial mode (no previous mode during initialization)
			this.applyMode(this._currentMode, false, undefined);
		} catch (error) {
			// Default to IDE mode on initialization failure
			this._currentMode = WorkbenchMode.IDE;
			this.logService.error('[ModeSwitchService] Error during service initialization, defaulting to IDE mode:', error);

			// Attempt to apply IDE mode even if storage failed
			try {
				this.applyMode(this._currentMode, false, undefined);
			} catch (layoutError) {
				this.logService.error('[ModeSwitchService] Failed to apply IDE mode during error recovery:', layoutError);
			}
		}
		// test-workbench_change end
	}

	private isValidMode(mode: string | undefined): boolean {
		return mode === WorkbenchMode.IDE || mode === WorkbenchMode.Partner;
	}

	get currentMode(): WorkbenchMode {
		return this._currentMode;
	}

	toggleMode(): void {
		const newMode = this._currentMode === WorkbenchMode.IDE
			? WorkbenchMode.Partner
			: WorkbenchMode.IDE;
		this.setMode(newMode);
	}

	setMode(mode: WorkbenchMode): void {
		if (this._currentMode === mode) {
			return;
		}

		this.logService.info(`[ModeSwitchService] Switching mode from ${this._currentMode} to ${mode}`);

		// test-workbench_change start - store previous mode for error recovery
		const previousMode = this._currentMode;
		// test-workbench_change end

		this._currentMode = mode;
		// test-workbench_change start - pass previous mode for error recovery
		this.applyMode(mode, true, previousMode);
		// test-workbench_change end
		this.saveMode(mode);
		this._onDidChangeMode.fire(mode);
	}

	private applyMode(mode: WorkbenchMode, animate: boolean, previousMode?: WorkbenchMode): void {
		// test-workbench_change start - performance timing
		const startTime = performance.now();
		// test-workbench_change end

		// test-workbench_change start - error handling with revert capability
		try {
			if (mode === WorkbenchMode.IDE) {
				this.applyIDEMode();
			} else {
				this.applyPartnerMode();
			}
		} catch (error) {
			this.logService.error(`[ModeSwitchService] Error applying ${mode} mode:`, error);

			// Attempt to revert to previous mode if available
			if (previousMode !== undefined && previousMode !== mode) {
				this.logService.warn(`[ModeSwitchService] Attempting to revert to previous mode: ${previousMode}`);

				try {
					// Revert the current mode state
					this._currentMode = previousMode;

					// Try to apply the previous mode
					if (previousMode === WorkbenchMode.IDE) {
						this.applyIDEMode();
					} else {
						this.applyPartnerMode();
					}

					this.logService.info(`[ModeSwitchService] Successfully reverted to ${previousMode} mode`);

					// Save the reverted mode
					this.saveMode(previousMode);

					// Fire event to update UI
					this._onDidChangeMode.fire(previousMode);
				} catch (revertError) {
					this.logService.error(`[ModeSwitchService] Failed to revert to ${previousMode} mode:`, revertError);

					// Show notification to user if revert fails
					this.notificationService.notify({
						severity: Severity.Error,
						message: `Failed to switch workbench mode. Unable to revert to previous mode. Please restart VS Code.`,
						sticky: true
					});
				}
			} else {
				// No previous mode to revert to, just show error notification
				this.notificationService.notify({
					severity: Severity.Error,
					message: `Failed to apply workbench mode. Please restart VS Code.`,
					sticky: true
				});
			}

			// Re-throw the error after handling
			throw error;
		}
		// test-workbench_change end

		// test-workbench_change start - performance timing
		const elapsed = performance.now() - startTime;
		if (elapsed > 100) {
			this.logService.warn(`[ModeSwitchService] Layout update for ${mode} mode took ${elapsed.toFixed(2)}ms (exceeds 100ms threshold)`);
		} else {
			this.logService.trace(`[ModeSwitchService] Layout update for ${mode} mode completed in ${elapsed.toFixed(2)}ms`);
		}
		// test-workbench_change end
	}

	private applyIDEMode(): void {
		try {
			// test-workbench_change - Show all standard workbench parts
			this.layoutService.setPartHidden(false, Parts.BANNER_PART);
			this.layoutService.setPartHidden(false, Parts.ACTIVITYBAR_PART);
			this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
			this.layoutService.setPartHidden(false, Parts.PANEL_PART);
			this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
			this.layoutService.setPartHidden(false, Parts.EDITOR_PART);

			// test-workbench_change - Access private methods for parts not handled by setPartHidden
			const layoutServiceAny = this.layoutService as any;
			if (typeof layoutServiceAny.setStatusBarHidden === 'function') {
				layoutServiceAny.setStatusBarHidden(false);
			}
			if (typeof layoutServiceAny.setChatBarHidden === 'function') {
				layoutServiceAny.setChatBarHidden(false);
			}
			// test-workbench_change end
		} catch (error) {
			this.logService.error('[ModeSwitchService] Error showing workbench parts in IDE mode:', error);
			throw error;
		}
	}

	private applyPartnerMode(): void {
		try {
			// test-workbench_change - Hide all workbench parts except title bar for blank layout
			this.layoutService.setPartHidden(true, Parts.BANNER_PART);
			this.layoutService.setPartHidden(true, Parts.ACTIVITYBAR_PART);
			this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);
			this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
			this.layoutService.setPartHidden(true, Parts.EDITOR_PART);

			// test-workbench_change - Access private methods for parts not handled by setPartHidden
			// CHATBAR_PART and STATUSBAR_PART are not handled in the switch statement of setPartHidden
			// so we need to call the underlying methods directly
			const layoutServiceAny = this.layoutService as any;
			if (typeof layoutServiceAny.setStatusBarHidden === 'function') {
				layoutServiceAny.setStatusBarHidden(true);
			}
			if (typeof layoutServiceAny.setChatBarHidden === 'function') {
				layoutServiceAny.setChatBarHidden(true);
			}
			// test-workbench_change end
		} catch (error) {
			this.logService.error('[ModeSwitchService] Error hiding workbench parts in Partner mode:', error);
			throw error;
		}
	}

	private saveMode(mode: WorkbenchMode): void {
		// test-workbench_change start - error handling for storage persistence
		try {
			this.storageService.store(
				ModeSwitchService.STORAGE_KEY,
				mode,
				StorageScope.PROFILE,
				StorageTarget.USER
			);
			this.logService.trace(`[ModeSwitchService] Successfully saved mode: ${mode}`);
		} catch (error) {
			// Log warning but continue operation - mode will not persist across sessions
			this.logService.warn(`[ModeSwitchService] Failed to persist mode to storage: ${error}. Mode will not be saved across sessions.`);
		}
		// test-workbench_change end
	}
}

// Register the service
registerSingleton(IModeSwitchService, ModeSwitchService, InstantiationType.Delayed);

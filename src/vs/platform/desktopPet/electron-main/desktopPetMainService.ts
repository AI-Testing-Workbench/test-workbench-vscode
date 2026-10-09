/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file
// Owns the desktop pet floating window. It is a real, frameless, transparent
// window that is dressed up so it does not behave/look like a regular window
// (no taskbar/Dock entry, no focus stealing, hidden from Mission Control,
// always on top, click-through outside the pet pixels) — same technique the
// Trae CN "traebao" pet uses.

import { BrowserWindow, BrowserWindowConstructorOptions, IpcMainEvent, ipcMain, screen } from 'electron';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';

export const IDesktopPetMainService = createDecorator<IDesktopPetMainService>('desktopPetMainService');

export interface IDesktopPetMainService {
	readonly _serviceBrand: undefined;
	toggle(): Promise<boolean>;
	show(): void;
	hide(): void;
	isVisible(): boolean;
}

const PET_SIZE = 200;
const SCREEN_MARGIN = 24;
const CURSOR_POLL_MS = 60;

// Click-through hit region: a circle over the pet's face (see the theme's
// bottom-anchored objectScale). Everything outside stays click-through.
const HIT_CENTER_X_RATIO = 0.5;
const HIT_CENTER_Y_RATIO = 0.44;
const HIT_RADIUS_RATIO = 0.2;

const STORAGE_ENABLED = 'desktopPet.enabled';
const STORAGE_POSITION = 'desktopPet.position';

const HTML_PATH = 'vs/platform/desktopPet/electron-main/media/desktopPet.html';
const PRELOAD_PATH = 'vs/platform/desktopPet/electron-main/media/desktopPet-preload.js';

interface IPetPosition {
	readonly x: number;
	readonly y: number;
}

export class DesktopPetMainService extends Disposable implements IDesktopPetMainService {

	declare readonly _serviceBrand: undefined;

	private _window: BrowserWindow | undefined;
	private _enabled = true;
	private _ready = false;
	private _ignoring = false;
	private _dragging = false;
	private _dragOffset: IPetPosition | undefined;
	private _cursorTimer: ReturnType<typeof setInterval> | undefined;

	private readonly _onDragStart = (event: IpcMainEvent) => {
		if (!this._isPetSender(event)) {
			return;
		}
		this._dragging = true;
		this._dragOffset = undefined;
	};

	private readonly _onDragMove = (event: IpcMainEvent, screenX: number, screenY: number) => {
		if (!this._isPetSender(event) || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
			return;
		}
		const win = this._window;
		if (!win || win.isDestroyed()) {
			return;
		}
		const [winX, winY] = win.getPosition();
		if (!this._dragOffset) {
			this._dragOffset = { x: screenX - winX, y: screenY - winY };
		}
		win.setPosition(Math.round(screenX - this._dragOffset.x), Math.round(screenY - this._dragOffset.y), false);
	};

	private readonly _onDragEnd = (event: IpcMainEvent) => {
		if (!this._isPetSender(event)) {
			return;
		}
		this._dragging = false;
		this._dragOffset = undefined;
		this._savePosition();
	};

	constructor(
		@IApplicationStorageMainService private readonly storageService: IApplicationStorageMainService,
		@ILifecycleMainService private readonly lifecycleService: ILifecycleMainService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._installIpc();

		// Hide the pet when the last workbench window closes (macOS keeps the
		// app alive, so this keeps "follow the app window" behavior).
		this._register(this.windowsMainService.onDidChangeWindowsCount(e => {
			if (!this._ready) {
				return;
			}
			if (e.newCount === 0) {
				this.hide();
			} else if (this._enabled) {
				this.show();
			}
		}));

		this._register(this.lifecycleService.onWillShutdown(() => this._teardown()));
		this._register(toDisposable(() => this._teardown()));

		Promise.all([
			this.storageService.whenReady,
			this.lifecycleService.when(LifecycleMainPhase.Ready)
		]).then(() => {
			this._ready = true;
			this._enabled = this.storageService.getBoolean(STORAGE_ENABLED, StorageScope.APPLICATION, true);
			if (this._enabled) {
				this.show();
			}
		}).catch(err => this.logService.error('[desktopPet] startup failed', err));
	}

	isVisible(): boolean {
		return !!this._window && !this._window.isDestroyed() && this._window.isVisible();
	}

	show(): void {
		let win = this._window;
		if (!win || win.isDestroyed()) {
			win = this._window = this._createWindow();
		}
		try {
			win.showInactive();
		} catch (err) {
			this.logService.error('[desktopPet] showInactive failed', err);
		}
		this._startCursorTracking();
	}

	hide(): void {
		this._stopCursorTracking();
		const win = this._window;
		if (win && !win.isDestroyed()) {
			win.hide();
		}
	}

	async toggle(): Promise<boolean> {
		if (this.isVisible()) {
			this._enabled = false;
			this._storeEnabled(false);
			this.hide();
			return false;
		}
		this._enabled = true;
		this._storeEnabled(true);
		this.show();
		return true;
	}

	private _createWindow(): BrowserWindow {
		const position = this._loadPosition();
		const options: BrowserWindowConstructorOptions = {
			x: position.x,
			y: position.y,
			width: PET_SIZE,
			height: PET_SIZE,
			transparent: true,
			backgroundColor: '#00000000',
			frame: false,
			hasShadow: false,
			thickFrame: false,
			roundedCorners: false,
			resizable: false,
			movable: true,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			show: false,
			focusable: false,
			acceptFirstMouse: true,
			webPreferences: {
				preload: FileAccess.asFileUri(PRELOAD_PATH).fsPath,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
				// Use an isolated, non-persistent session so VS Code's default
				// session webRequest rules (which block file:/svg loads) do not
				// apply to the pet page.
				partition: 'desktop-pet'
			}
		};

		if (isMacintosh) {
			// NSPanel: does not activate, floats above fullscreen apps.
			options.type = 'panel';
			options.enableLargerThanScreen = true;
		}

		const win = new BrowserWindow(options);
		win.setMenuBarVisibility(false);

		// Defensive transparency: make sure no opaque background survives on any
		// platform (window shadow is controlled by the `hasShadow: false` option).
		try {
			win.setBackgroundColor('#00000000');
		} catch {
			// ignore
		}

		win.on('closed', () => {
			if (this._window === win) {
				this._window = undefined;
			}
			this._stopCursorTracking();
		});
		win.on('hide', () => this._stopCursorTracking());
		win.on('show', () => this._startCursorTracking());
		win.webContents.on('render-process-gone', (_e, details) => {
			this.logService.error('[desktopPet] renderer gone', details.reason);
		});

		this._applyFloatingBehavior(win);
		this._applyClickThrough(win, true);

		win.loadFile(FileAccess.asFileUri(HTML_PATH).fsPath).catch(err => {
			this.logService.error('[desktopPet] failed to load page', err);
		});

		return win;
	}

	private _applyFloatingBehavior(win: BrowserWindow): void {
		if (isMacintosh) {
			win.setAlwaysOnTop(true, 'screen-saver');
			try {
				win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
			} catch {
				// ignore
			}
			try {
				win.setHiddenInMissionControl(true);
			} catch {
				// ignore
			}
		} else if (isWindows) {
			win.setAlwaysOnTop(true, 'screen-saver');
		} else if (isLinux) {
			win.setAlwaysOnTop(true);
			try {
				win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
			} catch {
				// ignore
			}
		}
		try {
			win.setSkipTaskbar(true);
		} catch {
			// ignore
		}
	}

	private _applyClickThrough(win: BrowserWindow, ignore: boolean): void {
		this._ignoring = ignore;
		try {
			win.setIgnoreMouseEvents(ignore, { forward: true });
		} catch {
			try {
				win.setIgnoreMouseEvents(ignore);
			} catch {
				// ignore
			}
		}
	}

	private _startCursorTracking(): void {
		if (this._cursorTimer) {
			return;
		}
		this._cursorTimer = setInterval(() => this._tickCursor(), CURSOR_POLL_MS);
	}

	private _stopCursorTracking(): void {
		if (this._cursorTimer) {
			clearInterval(this._cursorTimer);
			this._cursorTimer = undefined;
		}
	}

	private _tickCursor(): void {
		const win = this._window;
		if (!win || win.isDestroyed() || !win.isVisible()) {
			return;
		}
		if (this._dragging) {
			return;
		}
		const point = screen.getCursorScreenPoint();
		const bounds = win.getContentBounds();
		const localX = point.x - bounds.x;
		const localY = point.y - bounds.y;
		const hit = this._hitTest(localX, localY, bounds.width, bounds.height);
		if (hit === !this._ignoring) {
			return;
		}
		this._applyClickThrough(win, !hit);
	}

	private _hitTest(localX: number, localY: number, width: number, height: number): boolean {
		const cx = width * HIT_CENTER_X_RATIO;
		const cy = height * HIT_CENTER_Y_RATIO;
		const r = width * HIT_RADIUS_RATIO;
		const dx = localX - cx;
		const dy = localY - cy;
		return dx * dx + dy * dy <= r * r;
	}

	private _installIpc(): void {
		ipcMain.on('desktopPet:drag-start', this._onDragStart);
		ipcMain.on('desktopPet:drag-move', this._onDragMove);
		ipcMain.on('desktopPet:drag-end', this._onDragEnd);
	}

	private _removeIpc(): void {
		ipcMain.removeListener('desktopPet:drag-start', this._onDragStart);
		ipcMain.removeListener('desktopPet:drag-move', this._onDragMove);
		ipcMain.removeListener('desktopPet:drag-end', this._onDragEnd);
	}

	private _isPetSender(event: IpcMainEvent): boolean {
		const win = this._window;
		return !!win && !win.isDestroyed() && !win.webContents.isDestroyed() && event.sender === win.webContents;
	}

	private _loadPosition(): IPetPosition {
		const stored = this.storageService.get(STORAGE_POSITION, StorageScope.APPLICATION);
		if (stored) {
			try {
				const parsed = JSON.parse(stored);
				if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
					return this._clampToDisplay(Math.round(parsed.x), Math.round(parsed.y));
				}
			} catch {
				// fall through to default placement
			}
		}
		const workArea = screen.getPrimaryDisplay().workArea;
		return {
			x: Math.round(workArea.x + workArea.width - PET_SIZE - SCREEN_MARGIN),
			y: Math.round(workArea.y + workArea.height - PET_SIZE - SCREEN_MARGIN * 2)
		};
	}

	private _clampToDisplay(x: number, y: number): IPetPosition {
		const workArea = screen.getDisplayNearestPoint({ x, y }).workArea;
		return {
			x: Math.round(Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - PET_SIZE))),
			y: Math.round(Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - PET_SIZE)))
		};
	}

	private _savePosition(): void {
		const win = this._window;
		if (!win || win.isDestroyed()) {
			return;
		}
		try {
			const [x, y] = win.getPosition();
			this.storageService.store(STORAGE_POSITION, JSON.stringify({ x, y }), StorageScope.APPLICATION, StorageTarget.MACHINE);
		} catch {
			// ignore
		}
	}

	private _storeEnabled(enabled: boolean): void {
		this.storageService.store(STORAGE_ENABLED, enabled, StorageScope.APPLICATION, StorageTarget.USER);
	}

	private _teardown(): void {
		this._stopCursorTracking();
		this._removeIpc();
		const win = this._window;
		this._window = undefined;
		if (win && !win.isDestroyed()) {
			win.destroy();
		}
	}
}

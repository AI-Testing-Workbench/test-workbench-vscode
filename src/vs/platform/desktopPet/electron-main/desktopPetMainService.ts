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

import { app, BrowserWindow, BrowserWindowConstructorOptions, IpcMainEvent, ipcMain, Menu, screen } from 'electron';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { IWindowsMainService, OpenContext } from '../../windows/electron-main/windows.js';

export const IDesktopPetMainService = createDecorator<IDesktopPetMainService>('desktopPetMainService');

export interface IDesktopPetMainService {
	readonly _serviceBrand: undefined;
	toggle(): Promise<boolean>;
	show(): void;
	hide(): void;
	isVisible(): boolean;
	/** test-workbench_change - open the conversation window from the pet. */
	openChat(): Promise<void>;
}

const PET_SIZE = 200;
const SCREEN_MARGIN = 24;
const CURSOR_POLL_MS = 60;
const POINTER_EPSILON = 1;

// test-workbench_change start
// Cloudling layout. The reference "Cloudling" theme renders its 88x72 viewBox
// through a normalized layout anchored to a 24x24 content box near the window
// baseline. These constants mirror desktopPet.html (and the reference
// hit-geometry.js) so the main-process hit region tracks the rendered face
// exactly.
const VIEW_BOX = { x: -32, y: -24, width: 88, height: 72 };
const LAYOUT_CONTENT_BOX_HEIGHT = 24;
const LAYOUT_CENTER_X = 12;
const LAYOUT_CENTER_X_RATIO = 0.5;
const LAYOUT_BASELINE_Y = 24;
const LAYOUT_BASELINE_BOTTOM_RATIO = 0.05;
const LAYOUT_VISIBLE_HEIGHT_RATIO = 0.41;
const FACE_CENTER = { x: 12, y: 12 };
const FACE_RADIUS = 13;

interface IArtRect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

function computeArtRect(windowWidth: number, windowHeight: number): IArtRect {
	const unitRatio = LAYOUT_VISIBLE_HEIGHT_RATIO / LAYOUT_CONTENT_BOX_HEIGHT;
	const width = windowWidth * VIEW_BOX.width * unitRatio;
	const height = windowHeight * VIEW_BOX.height * unitRatio;
	const leftRatio = LAYOUT_CENTER_X_RATIO - (LAYOUT_CENTER_X - VIEW_BOX.x) * unitRatio;
	const bottomRatio = LAYOUT_BASELINE_BOTTOM_RATIO - (VIEW_BOX.y + VIEW_BOX.height - LAYOUT_BASELINE_Y) * unitRatio;
	return {
		left: windowWidth * leftRatio,
		top: windowHeight - height - windowHeight * bottomRatio,
		width,
		height
	};
}
// test-workbench_change end

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
	private _hasAppeared = false; // test-workbench_change - once shown in the Agents window the pet stays visible
	private _ignoring = false;
	private _dragging = false;
	private _dragOffset: IPetPosition | undefined;
	private _cursorTimer: ReturnType<typeof setInterval> | undefined;
	private _lastPointerX = Number.NaN;
	private _lastPointerY = Number.NaN;
	private _lastPointerOver = false;

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

	// test-workbench_change start
	private readonly _onBrowserWindowFocus = (_event: unknown, window: BrowserWindow | undefined) => {
		// The pet window is non-focusable, but ignore it defensively.
		if (!window || window === this._window) {
			return;
		}
		this._syncVisibility();
	};
	// test-workbench_change end

	private readonly _onContextMenu = (event: IpcMainEvent) => {
		if (!this._isPetSender(event)) {
			return;
		}
		const win = this._window;
		if (!win || win.isDestroyed()) {
			return;
		}
		const menu = Menu.buildFromTemplate([
			{
				label: localize('desktopPet.openChat', "Open Chat Window"),
				click: () => {
					void this.openChat();
				}
			},
			{ type: 'separator' },
			{
				label: localize('desktopPet.hide', "Hide Desktop Pet"),
				click: () => {
					this._enabled = false;
					this._storeEnabled(false);
					this.hide();
				}
			}
		]);
		menu.popup({ window: win });
	};

	constructor(
		@IApplicationStorageMainService private readonly storageService: IApplicationStorageMainService,
		@ILifecycleMainService private readonly lifecycleService: ILifecycleMainService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._installIpc();

		// test-workbench_change start
		// The pet only appears while the Agents window is the active window.
		// Follow both window count changes (open/close) and code-window focus
		// changes so it shows on entering the Agents window and hides on leaving.
		this._register(this.windowsMainService.onDidChangeWindowsCount(() => this._syncVisibility()));
		this._register(this.windowsMainService.onDidSignalReadyWindow(() => this._syncVisibility()));
		this._register(this.windowsMainService.onDidDestroyWindow(() => this._syncVisibility()));
		app.on('browser-window-focus', this._onBrowserWindowFocus);
		this._register(toDisposable(() => app.removeListener('browser-window-focus', this._onBrowserWindowFocus)));
		// test-workbench_change end

		this._register(this.lifecycleService.onWillShutdown(() => this._teardown()));
		this._register(toDisposable(() => this._teardown()));

		Promise.all([
			this.storageService.whenReady,
			this.lifecycleService.when(LifecycleMainPhase.Ready)
		]).then(() => {
			this._ready = true;
			this._enabled = this.storageService.getBoolean(STORAGE_ENABLED, StorageScope.APPLICATION, true);
			this._syncVisibility();
		}).catch(err => this.logService.error('[desktopPet] startup failed', err));
	}

	isVisible(): boolean {
		return !!this._window && !this._window.isDestroyed() && this._window.isVisible();
	}

	show(): void {
		this._hasAppeared = true; // test-workbench_change
		let win = this._window;
		if (!win || win.isDestroyed()) {
			win = this._window = this._createWindow();
		}
		try {
			win.showInactive();
		} catch (err) {
			this.logService.error('[desktopPet] showInactive failed', err);
		}
		// Force the first pointer push after (re)showing.
		this._lastPointerX = Number.NaN;
		this._lastPointerY = Number.NaN;
		this._lastPointerOver = false;
		this._startCursorTracking();
	}

	hide(): void {
		this._stopCursorTracking();
		const win = this._window;
		if (win && !win.isDestroyed()) {
			win.hide();
		}
	}

	// test-workbench_change start
	/**
	 * The pet first appears only while the Agents window is the active window
	 * (its right-click "Open Chat Window" needs to activate the Agents window).
	 * Once it has appeared it stays visible and no longer hides when the user
	 * switches to an editor window. It hides again only when disabled or when
	 * no workbench window is left.
	 */
	private _syncVisibility(): void {
		if (!this._ready) {
			return;
		}
		const shouldShow = this._enabled
			&& this.windowsMainService.getWindowCount() > 0
			&& (
				this._hasAppeared
				|| (this.windowsMainService.getFocusedWindow() ?? this.windowsMainService.getLastActiveWindow())?.config?.isSessionsWindow === true
			);
		this.logService.trace(`[desktopPet] sync visibility: enabled=${this._enabled}, hasAppeared=${this._hasAppeared}, shouldShow=${shouldShow}`);
		if (shouldShow) {
			this.show();
		} else {
			this.hide();
		}
	}
	// test-workbench_change end

	async toggle(): Promise<boolean> {
		if (this.isVisible()) {
			this._enabled = false;
			this._storeEnabled(false);
			this.hide();
			return false;
		}
		this._enabled = true;
		this._storeEnabled(true);
		this._syncVisibility(); // test-workbench_change
		return this.isVisible(); // test-workbench_change
	}

	// test-workbench_change start
	// Pet ➜ conversation window. Mirrors the Trae "traebao" pet, whose floating
	// chat panel is opened by the workbench command below. Dispatch the action to
	// the window the user is currently looking at (focused, else last active) so
	// the compact window is an auxiliary child of that window and no other window
	// (Agents window, editor Chat view, ...) is brought to the front. The target
	// window enables Agent Host on demand inside `desktopPet.openChatWindow`, so
	// TestAgent works there without changing any configuration. Only when there is
	// no workbench window at all do we open an Agents window first.
	async openChat(): Promise<void> {
		const runActionArgs = { id: 'desktopPet.openChatWindow', from: 'mouse' };
		const target = this.windowsMainService.getFocusedWindow() ?? this.windowsMainService.getLastActiveWindow();
		if (target) {
			target.sendWhenReady('vscode:runAction', CancellationToken.None, runActionArgs);
			return;
		}
		try {
			const windows = await this.windowsMainService.openAgentsWindow({
				context: OpenContext.API,
				cli: this.environmentMainService.args
			});
			const window = windows[0];
			window?.sendWhenReady('vscode:runAction', CancellationToken.None, runActionArgs);
		} catch (err) {
			this.logService.error('[desktopPet] failed to open chat window', err);
		}
	}
	// test-workbench_change end

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

		// The renderer converts these window-local pixels into the SVG's own
		// user units and forwards them to the Cloudling pointer bridge.
		this._sendPointer(win, localX, localY, hit);

		if (hit === !this._ignoring) {
			return;
		}
		this._applyClickThrough(win, !hit);
	}

	private _sendPointer(win: BrowserWindow, localX: number, localY: number, over: boolean): void {
		if (win.webContents.isDestroyed()) {
			return;
		}
		const x = Math.round(localX);
		const y = Math.round(localY);
		if (over === this._lastPointerOver
			&& Number.isFinite(this._lastPointerX)
			&& Math.abs(x - this._lastPointerX) < POINTER_EPSILON
			&& Math.abs(y - this._lastPointerY) < POINTER_EPSILON) {
			return;
		}
		this._lastPointerX = x;
		this._lastPointerY = y;
		this._lastPointerOver = over;
		win.webContents.send('desktopPet:pointer', x, y, over);
	}

	private _hitTest(localX: number, localY: number, width: number, height: number): boolean {
		const art = computeArtRect(width, height);
		const scale = art.width / VIEW_BOX.width;
		const cx = art.left + (FACE_CENTER.x - VIEW_BOX.x) * scale;
		const cy = art.top + (FACE_CENTER.y - VIEW_BOX.y) * scale;
		const r = FACE_RADIUS * scale;
		const dx = localX - cx;
		const dy = localY - cy;
		return dx * dx + dy * dy <= r * r;
	}

	private _installIpc(): void {
		ipcMain.on('desktopPet:drag-start', this._onDragStart);
		ipcMain.on('desktopPet:drag-move', this._onDragMove);
		ipcMain.on('desktopPet:drag-end', this._onDragEnd);
		ipcMain.on('desktopPet:context-menu', this._onContextMenu);
	}

	private _removeIpc(): void {
		ipcMain.removeListener('desktopPet:drag-start', this._onDragStart);
		ipcMain.removeListener('desktopPet:drag-move', this._onDragMove);
		ipcMain.removeListener('desktopPet:drag-end', this._onDragEnd);
		ipcMain.removeListener('desktopPet:context-menu', this._onContextMenu);
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

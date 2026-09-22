/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IMouseWheelEvent } from '../../../../base/browser/mouseEvent.js';
import type { WebviewStyles } from './webview.js';

type KeyEvent = {
	key: string;
	keyCode: number;
	code: string;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	repeat: boolean;
}

type WebViewDragEvent = {
	shiftKey: boolean;
}

export type FromWebviewMessage = {
	'onmessage': { message: any; transfer?: ArrayBuffer[] };
	'did-click-link': { uri: string };
	'did-scroll': { scrollYPercentage: number };
	'did-focus': void;
	'did-blur': void;
	'did-load': void;
	'did-find': { didFind: boolean };
	'do-update-state': string;
	'do-reload': void;
	'load-resource': { id: number; path: string; query: string; scheme: string; authority: string; ifNoneMatch?: string };
	'load-localhost': { id: string; origin: string };
	'did-scroll-wheel': IMouseWheelEvent;
	'fatal-error': { message: string };
	'no-csp-found': void;
	'did-keydown': KeyEvent;
	'did-keyup': KeyEvent;
	'did-context-menu': { clientX: number; clientY: number; context: { [key: string]: unknown } };
	'drag-start': void;
	'drag': WebViewDragEvent;
	'updated-intrinsic-content-size': { width: number; height: number };
	// test-workbench_change start
	// 扩展 webview 日志截获上报（pre/index.html 转发），携带消息内容、日志级别与
	// 链路追踪字段（traceId/traceIndex 在 webview 截获脚本产生侧赋值）
	'__vscode-log-capture': { message: string; logLevel?: string; traceId?: string; traceIndex?: number };
	// test-workbench_change end
};

interface UpdateContentEvent {
	contents: string;
	title: string | undefined;
	options: {
		allowMultipleAPIAcquire: boolean;
		allowScripts: boolean;
		allowForms: boolean;
		// test-workbench_change start
		// capturedLog 注入决策下沉（宿主 webviewElement 计算后透传）：
		// logCaptureEnabled 为 logSourceEnabled('webview') 与 extensionIdEnabled 的合成
		// （false 时不注入截获脚本，postMessage 全链路归零）；
		// logCaptureTraceEnabled 为 capturedLog.traceEnabled（控制脚本内 traceId 计算）；
		// logCaptureLogLevels 为 capturedLog.logLevelEnabled（'all' | 级别数组 | undefined，
		// 控制脚本内级别过滤，过滤判断先于 trace 推进，被过滤日志不占 traceIndex）。
		logCaptureEnabled?: boolean;
		logCaptureTraceEnabled?: boolean;
		// 与 product.ts 的 logLevelEnabled?: string | readonly string[] 保持一致
		logCaptureLogLevels?: string | readonly string[];
		// test-workbench_change end
	};
	state: any;
	cspSource: string;
	confirmBeforeClose: string;
}

export type ToWebviewMessage = {
	'focus': void;
	'message': { message: any; transfer?: ArrayBuffer[] };
	'execCommand': string;
	'did-load-resource':
	| { id: number; status: 401 | 404; path: string }
	| { id: number; status: 304; path: string; mime: string; mtime: number | undefined }
	| { id: number; status: 200; path: string; mime: string; data: any; etag: string | undefined; mtime: number | undefined }
	;
	'did-load-localhost': {
		id: string;
		origin: string;
		location: string | undefined;
	};
	'set-confirm-before-close': string;
	'set-context-menu-visible': { visible: boolean };
	'initial-scroll-position': number;
	'content': UpdateContentEvent;
	'set-title': string | undefined;
	'styles': {
		styles: WebviewStyles;
		activeTheme: string;
		themeId: string;
		themeLabel: string;
		reduceMotion: boolean;
		screenReader: boolean;
	};
	'find': { value: string; previous?: boolean };
	'find-stop': { clearSelection?: boolean };
};


export interface WebviewHostMessaging {
	postMessage<K extends keyof FromWebviewMessage>(channel: K, data: FromWebviewMessage[K], transfer?: []): void;

	onMessage<K extends keyof ToWebviewMessage>(channel: K, handler: (e: Event, data: ToWebviewMessage[K]) => void): void;
}

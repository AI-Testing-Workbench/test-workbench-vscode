/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../log/common/log.js';

export interface IOpenCodeEvent {
	readonly type: string;
	readonly properties: Record<string, unknown>;
}

export type OpenCodeEventCallback = (sessionID: string, event: IOpenCodeEvent) => void;

/**
 * SSE client for the opencode `GET /global/event` endpoint.
 *
 * 不可用 `GET /event`:它按 directory(InstanceState ScopedCache)隔离 bus,
 * 本代理连接的订阅者可能收不到当前会话所在 directory 的事件。
 * `/global/event` 走进程级 GlobalBus,所有 directory 的事件都会推到。
 * 外层 SSE 载荷是 `{ directory, project, workspace, payload }`,
 * 真实事件在 `payload`(`{ id, type, properties }`)。
 *
 * Opens a persistent HTTP connection, parses the SSE stream, and
 * invokes a callback for each event. Handles reconnection on errors.
 */
export class OpenCodeEventStream extends Disposable {

	private _active = false;
	private _abortController: AbortController | undefined;

	constructor(
		private readonly _baseUrl: string,
		private readonly _authHeader: string,
		private readonly _onEvent: OpenCodeEventCallback,
		private readonly _logService: ILogService,
	) {
		super();
	}

	/** Start the SSE connection. Safe to call multiple times. */
	start(): void {
		if (this._active) { return; }
		this._active = true;
		this._connect();
	}

	stop(): void {
		this._active = false;
		this._abortController?.abort();
		this._abortController = undefined;
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = undefined;
		}
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}

	// ── Connection loop ──────────────────────────────────────────────────

	private _connect(): void {
		if (!this._active) { return; }

		this._abortController = new AbortController();
		const url = `${this._baseUrl}/global/event`;
		const headers: Record<string, string> = {};
		if (this._authHeader) { headers['Authorization'] = this._authHeader; }

		this._logService.info('[OpenCode] connecting to SSE event stream');

		fetch(url, { headers, signal: this._abortController.signal })
			.then(resp => {
				if (!resp.ok) {
					this._logService.warn(`[OpenCode] SSE connection failed: HTTP ${resp.status}`);
					this._scheduleReconnect();
					return;
				}
				this._logService.info('[OpenCode] SSE stream connected');
				const reader = resp.body?.getReader();
				if (!reader) {
					this._scheduleReconnect();
					return;
				}
				return this._readStream(reader);
			})
			.catch(err => {
				if (err instanceof Error && err.name === 'AbortError') { return; }
				this._logService.warn(`[OpenCode] SSE connection error: ${err}`);
				this._scheduleReconnect();
			});
	}

	// 未派发的 SSE 缓冲:每消费一个事件即 trim 掉已处理部分(防长连接
	// buffer 无限膨胀 + O(n²) 全串 lastIndexOf),重连/断流时置空
	//(旧流截断的碎片不重放)。 // test-workbench_change
	private _sseBuffer = '';

	private async _readStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
		const decoder = new TextDecoder();
		this._sseBuffer = '';

		try {
			while (this._active) {
				const { done, value } = await reader.read();
				if (value) { this._sseBuffer += decoder.decode(value, { stream: true }); }
				this._parseSSE();
				if (done) { break; }
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') { return; }
			this._logService.warn(`[OpenCode] SSE stream error: ${err}`);
		} finally {
			try { reader.cancel(); } catch { /* ignore */ }
			this._sseBuffer = '';
		}

		this._logService.info('[OpenCode] SSE stream ended');
		this._scheduleReconnect();
	}

	// ── SSE parsing ──────────────────────────────────────────────────────

	private _parseSSE(): void {
		// SSE events are separated by double newlines
		const eventEnd = this._sseBuffer.lastIndexOf('\n\n');
		if (eventEnd < 0) { return; }

		const raw = this._sseBuffer.slice(0, eventEnd + 2);
		this._sseBuffer = this._sseBuffer.slice(eventEnd + 2);

		const parts = raw.split('\n\n');
		for (const part of parts) {
			if (!part.trim()) { continue; }
			const event = this._parseSSEEvent(part);
			if (!event) { continue; }

			const sessionID = String(event.properties.sessionID ?? '');
			if (sessionID) {
				try {
					this._onEvent(sessionID, event);
				} catch (e) {
					this._logService.warn(`[OpenCode] event handler error: ${e}`);
				}
			}
		}
	}

	private _parseSSEEvent(raw: string): IOpenCodeEvent | undefined {
		let data = '';

		for (const line of raw.split('\n')) {
			if (line.startsWith('data:')) {
				const d = line.slice(5).trim();
				if (data) { data += '\n'; }
				data += d;
			}
		}

		if (!data) { return undefined; }
		try {
			const parsed = JSON.parse(data) as {
				type?: string;
				properties?: Record<string, unknown>;
				// /global/event 外层信封:真实事件在 payload
				payload?: { id?: string; type?: string; properties?: Record<string, unknown> };
			};
			// 兼容 /event 直发结构(保留向后兼容)与 /global/event 信封结构
			const inner = parsed.payload ?? parsed;
			if (!inner.type || !inner.properties) { return undefined; }
			return {
				type: inner.type,
				properties: inner.properties,
			};
		} catch {
			return undefined;
		}
	}

	// ── Reconnection ─────────────────────────────────────────────────────

	private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private _reconnectDelay = 1_000;

	private _scheduleReconnect(): void {
		if (!this._active) { return; }
		this._logService.info(`[OpenCode] SSE reconnecting in ${this._reconnectDelay}ms`);
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = undefined;
			this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30_000);
			this._connect();
		}, this._reconnectDelay);
	}
}

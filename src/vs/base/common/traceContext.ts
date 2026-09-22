/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

// 链路追踪（capturedLog 第二阶段）：traceId / traceIndex 的产生侧赋值逻辑。
//
// 语义（与 capturedLog_README.md 4.5 节一致）：
//  - traceId：同一次"业务代码处理流程"产生的日志共享同一个 traceId；
//  - traceIndex：同一 traceId 内的日志按产生顺序从 1 开始递增编号（1,2,3,...），
//    用于对一次流程的捕获消息排序（即使上报/传输乱序也能按 traceIndex 还原原始顺序）。
//    说明：spanId/parentSpanId 在全链路追踪中的语义是标识多个处理节点（进程）的先后
//    顺序；本场景是同一进程内的一条消息流，没有多节点概念，故不采用这两个字段。
//
// 边界判定：console 截获点看不到业务流程的进入/退出，因此用"调用路径指纹 + 时间窗"近似：
//  - 与上一条日志的调用路径指纹一致（同一调用路径），且间隔未超过 TRACE_WINDOW_MS，
//    视为同一次流程的延续（traceId 不变，traceIndex 递增）；
//  - 调用路径指纹不可得（如 outputChannel 文件轮询读取）时，仅按时间窗判定；
//  - 否则开启新的 trace（新 traceId，traceIndex 从 1 重新开始）。
//
// 使用方式：每个截获点（extensionHost / webview / renderer / outputChannel）各自维护一个
// TraceContextState 实例，产生日志消息时调用 next() 取本次消息的链路字段（产生侧赋值，
// 禁止按到达顺序在渲染进程补值）。

import { generateUuid } from './uuid.js';

export interface ITraceFields {
	readonly traceId: string;
	readonly traceIndex: number;
}

// 同一 trace 内相邻两条日志的最大间隔（毫秒），超过则视为新的一次处理流程。
// 取 3s 的平衡点：
//  - 过短（如 1s）会把一次流程中的异步步骤（await、定时任务、outputChannel 轮询批次）
//    误拆成多个 traceId；
//  - 过长（如 30s）会把"调用路径指纹"近似的不同业务流误合并——同一文件内的不同命令
//    （匿名函数帧无函数名、去掉行列号后不可区分）加上相同的框架帧，指纹完全相同，
//    实测两个命令间隔约 3.4s 被误合并成同一条 trace。
// 时间窗只是近似边界，配合调用路径指纹一起使用，无法做到与业务语义完全一致。
export const TRACE_WINDOW_MS = 3000;

// 截获层自身的栈帧（应被忽略，不参与调用路径指纹匹配）。
const IGNORED_FRAME_PATTERNS: RegExp[] = [
	/extHostConsoleForwarder/,
	/rendererLogCapture/,
	/traceContext/,
	/__vscode_log_capture__/,
	// Node 原生 console.assert 失败时内部调用 console.error（被截获），其调用栈中会多出
	// Console.assert 的 node:console 帧；忽略之，使 assert 产生的日志与同一业务代码内
	// 直接 console.log/error 的指纹一致，避免把同一次流程误拆成两个 traceId。
	/node:console|node:internal\/console/
];

// 调用路径指纹最多取的非忽略帧数（足够区分不同调用路径，又不至于过深）。
const MAX_STACK_FRAMES = 3;

/**
 * 从调用栈文本提取"调用路径指纹"：跳过首行（"Error: ..."）与截获层自身帧，
 * 去掉行号列号（同一函数内的不同调用点视作同一调用路径），取前 MAX_STACK_FRAMES 帧。
 * 调用栈不可得时返回 undefined（此时仅按时间窗判定流程边界）。
 * @param stack 原始调用栈文本（new Error().stack 等）
 * @param skipFrames 显式跳过调用栈顶部 N 帧。当截获层匿名包装帧的文件名无法用
 * IGNORED_FRAME_PATTERNS 识别时使用（如 webview 截获脚本帧的文件名是扩展 webview
 * 自身的文档路径，无法按模式排除），默认 0。
 */
export function extractStackKey(stack: string | undefined, skipFrames = 0): string | undefined {
	if (!stack) {
		return undefined;
	}
	const lines = stack.split('\n');
	// 第 0 行是 "Error: ..."，跳过；再跳过截获层显式指定的顶部帧
	const frames = lines.slice(1 + skipFrames).map(line => line.trim()).filter(Boolean);
	const keyFrames: string[] = [];
	for (const frame of frames) {
		if (IGNORED_FRAME_PATTERNS.some(pattern => pattern.test(frame))) {
			continue;
		}
		// 去掉行号列号（形如 ":12:34" / ":12:34)"），保留函数名与文件路径
		keyFrames.push(frame.replace(/:\d+:\d+\)?\s*$/, ''));
		if (keyFrames.length >= MAX_STACK_FRAMES) {
			break;
		}
	}
	return keyFrames.length > 0 ? keyFrames.join('|') : undefined;
}

/**
 * 产生侧链路追踪状态机。每个截获点维护一个实例。
 * next() 返回本次日志消息的 traceId/traceIndex，并推进内部状态：
 * 同一次流程的连续消息共享 traceId，traceIndex 从 1 开始递增。
 */
export class TraceContextState {

	private _traceId: string | undefined;
	private _traceIndex = 0;
	private _lastStackKey: string | undefined;
	private _lastTimestamp = 0;
	// 最近一次活跃 trace 的快照（命令边界 reset 后仍保留），供异步跨命令边界的日志
	// （如 extensionHost 的 unhandledRejection 延迟 1s 警告）恢复归属到产生它的流程。
	private _lastActiveTraceId: string | undefined;
	private _lastActiveTraceIndex = 0;
	private _lastActiveTimestamp = 0;

	next(stackKey: string | undefined): ITraceFields {
		const now = Date.now();
		// 延续判定：已有活跃 trace，且调用路径指纹一致（双方均无指纹时仅看时间窗），
		// 且间隔未超过时间窗 → 复用 traceId，traceIndex 递增。
		if (this._traceId
			&& (stackKey === this._lastStackKey || (stackKey === undefined && this._lastStackKey === undefined))
			&& now - this._lastTimestamp <= TRACE_WINDOW_MS) {
			this._traceIndex += 1;
			this._lastStackKey = stackKey;
			this._lastTimestamp = now;
			this._rememberLastActive(now);
			return { traceId: this._traceId, traceIndex: this._traceIndex };
		}
		// 开启新 trace：新 traceId，traceIndex 从 1 重新开始。
		const traceId = generateUuid();
		this._traceId = traceId;
		this._traceIndex = 1;
		this._lastStackKey = stackKey;
		this._lastTimestamp = now;
		this._rememberLastActive(now);
		return { traceId, traceIndex: 1 };
	}

	/**
	 * 恢复最近一次活跃 trace（异步跨命令边界场景专用）。
	 * 例：extensionHost 的 unhandledRejection 处理器延迟 1s 才输出警告，此时命令边界
	 * resetTraceContext 已清空当前状态，无法用 next() 正常延续；若最近活跃 trace 仍
	 * 在时间窗内，则基于它继续递增 traceIndex（与产生该 rejection 的流程共享 traceId）。
	 * @returns 恢复后的链路字段；无最近活跃 trace 或已超窗时返回 undefined（调用方应回退 next()）。
	 */
	resumeLastTrace(): ITraceFields | undefined {
		const now = Date.now();
		if (!this._lastActiveTraceId || now - this._lastActiveTimestamp > TRACE_WINDOW_MS) {
			return undefined;
		}
		this._traceId = this._lastActiveTraceId;
		this._traceIndex = this._lastActiveTraceIndex + 1;
		this._lastStackKey = undefined;
		this._lastTimestamp = now;
		this._rememberLastActive(now);
		return { traceId: this._traceId, traceIndex: this._traceIndex };
	}

	private _rememberLastActive(now: number): void {
		this._lastActiveTraceId = this._traceId;
		this._lastActiveTraceIndex = this._traceIndex;
		this._lastActiveTimestamp = now;
	}

	/**
	 * 重置状态：清空当前活跃 trace，使下一次 next() 必定开启新 trace。
	 * 用于命令边界——每次扩展命令执行前后各调用一次，避免两次不同命令调用
	 * 因“调用路径指纹一致 + 间隔未超时间窗”被误合并成同一条 trace。
	 * 注意：不清空最近活跃 trace 快照（供 unhandledRejection 等异步警告恢复归属）。
	 */
	reset(): void {
		this._traceId = undefined;
		this._traceIndex = 0;
		this._lastStackKey = undefined;
		this._lastTimestamp = 0;
	}
}

/**
 * 扩展宿主（extensionHost）链路追踪全局单例。
 * 独立放在本模块（仅依赖 uuid），避免 extHostCommands ⇄ extHostConsoleForwarder ⇄
 * extHostExtensionService 的循环依赖——ESM 下装饰器在模块顶层求值，若从
 * extHostConsoleForwarder 导入会触发 “Cannot access ... before initialization” TDZ 错误。
 */
export const extensionHostTraceContext = new TraceContextState();

/**
 * 重置扩展宿主链路追踪状态（命令边界重置 traceId）。
 * 由 extHostCommands 在每次扩展命令执行前后调用：执行开始前重置使本命令日志
 * 从 traceIndex 1 开始独立成 trace；命令结束（finally）再重置，隔离下一条命令
 * （解决匿名回调指纹相同 + 间隔在时间窗内时两次不同命令被误合并成同一 traceId）。
 */
export function resetTraceContext(): void {
	extensionHostTraceContext.reset();
}

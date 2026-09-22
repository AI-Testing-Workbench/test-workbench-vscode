/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

// 渲染进程核心日志截获与上报（logSource = 'renderer'）。
//
// 目标：DevTools 控制台"全量可见即收"。渲染进程核心日志经 ILogService（NativeLogService
// 内部使用 ConsoleLogger）输出到 console，因此 hook console 即可覆盖绝大部分核心日志；
// 另补 window error / unhandledrejection 两个 DevTools 可见的错误输出。
//
// 控制：仅受 product.json capturedLog.logSourceEnabled 控制（入口处用
// isCapturedLogSourceEnabled(productService, 'renderer') 判断后才调用
// installRendererLogCapture），与 extensionIdEnabled / outputChannelNameEnabled 无关。
// traceEnabled 下沉：trace 字段计算与否由入口传入的 traceEnabled 决定（关闭时跳过，
// 与改动前行为一致，见 installRendererLogCapture 参数）。
// logLevelEnabled 下沉（方案 2，四条链路统一应用）：级别过滤由入口传入的
// logLevelEnabledParam 决定（'all' 全放行 / 级别数组仅放行集合内级别 / 未配置全部屏蔽）；
// 过滤判断先于 trace 状态机推进（computeTrace 惰性求值），被过滤日志不占 traceIndex
// （编号连续）、不上报；原生 console 行为不受影响（native(...) 先行，DevTools 仍可见）。
//
// 性能：只有配置启用时才会 hook console 与监听 window 事件，未启用时本模块零开销；
// traceEnabled 关闭时跳过 trace 状态机推进与指纹计算。
//
// 上报：启动早期渲染进程 telemetry 尚未就绪，截获消息先缓冲在内存；待
// registerRendererLogCaptureReporter() 被调用（desktop.main.ts 中 startup() 之后）即
// 注册上报器并 flush 缓冲，之后实时转发。

// test-workbench_change start
import { extractStackKey, ITraceFields, TraceContextState } from '../../../../base/common/traceContext.js';
// test-workbench_change end

type RendererLogCaptureReporter = (message: string, logLevel: string, traceFields?: ITraceFields) => void;

// 启动早期缓冲（telemetry 就绪前的消息），设上限防止内存膨胀
const capturedBuffer: Array<{ message: string; logLevel: string; traceFields?: ITraceFields }> = [];
const MAX_BUFFER_SIZE = 2000;
let bufferTruncated = false;

// test-workbench_change start
// 链路追踪状态机（capturedLog 第二阶段）：产生侧（本进程 console 截获点）维护，
// 同一次业务处理流程的日志共享 traceId，traceIndex 从 1 开始递增编号。
const traceContext = new TraceContextState();
// traceEnabled 下沉：仅 capturedLog.traceEnabled 开启时计算 trace 字段
// （关闭时跳过状态机推进与栈指纹计算，与改动前行为一致）。
// 该值在 installRendererLogCapture(traceEnabled) 时由入口（desktop.main.ts）传入。
let traceEnabled = false;
// logLevelEnabled 下沉（方案 2，四条链路统一应用）：级别过滤名单。
// 'all' 全放行；Set<string> 仅放行集合内级别；undefined（未配置/无效）全部屏蔽。
// 该值在 installRendererLogCapture(traceEnabled, logLevelEnabledParam) 时由入口传入。
let logLevelEnabled: 'all' | Set<string> | undefined;
// test-workbench_change end

let reporter: RendererLogCaptureReporter | undefined;
let inReporter = false; // 防重入：上报过程中若触发 console 输出，不再递归截获

function argsToString(args: unknown[]): string {
	return args.map((arg) => {
		if (typeof arg === 'string') {
			return arg;
		}
		try {
			return JSON.stringify(arg);
		} catch {
			return String(arg);
		}
	}).join(' ');
}

// 级别过滤（capturedLog.logLevelEnabled 下沉，方案 2，四条链路统一应用）：
// 'all' 全放行；指定级别集合仅集合内放行；未配置（undefined）全部屏蔽。
// 与渲染进程 productService 的 isCapturedLogLevelEnabled 语义一致。
function isLogLevelAllowed(logLevel: string): boolean {
	if (logLevelEnabled === 'all') {
		return true;
	}
	if (logLevelEnabled instanceof Set) {
		return logLevelEnabled.has(logLevel);
	}
	return false;
}

// 统一上报入口（级别过滤 + 惰性 trace）：过滤判断先于 computeTrace（trace 状态机推进），
// 被过滤日志不占 traceIndex（编号连续）、不上报，且跳过 new Error().stack 栈捕获。
// 原生 console 行为不受影响（native(...) 已在调用点先行执行，DevTools 仍可见）。
function logToReporter(message: string, logLevel: string, computeTrace: () => ITraceFields | undefined): void {
	if (!isLogLevelAllowed(logLevel)) {
		return;
	}
	sendToReporter(message, logLevel, computeTrace());
}

function sendToReporter(message: string, logLevel: string, traceFields?: ITraceFields): void {
	try {
		if (inReporter) {
			return;
		}
		// test-workbench_change start
		// 方案 1 去重：mainThreadConsole 对已按 extensionHost 源上报的扩展宿主消息，在写
		// console 时置位抑制标记（console.__testWorkbenchSuppressRendererLogCapture）。
		// 此处检测到即跳过本次上报——原生 console 行为不受影响（DevTools 仍可见），
		// 仅避免同一消息被 renderer 源重复上报；标志由 mainThreadConsole try/finally 保证清除。
		if ((console as unknown as { __testWorkbenchSuppressRendererLogCapture?: boolean }).__testWorkbenchSuppressRendererLogCapture) {
			return;
		}
		// test-workbench_change end
		if (reporter) {
			inReporter = true;
			try {
				reporter(message, logLevel, traceFields);
			} finally {
				inReporter = false;
			}
		} else {
			if (capturedBuffer.length >= MAX_BUFFER_SIZE) {
				if (!bufferTruncated) {
					bufferTruncated = true;
					capturedBuffer.push({ message: `[renderer] 启动期日志过多，已截断（仅保留前 ${MAX_BUFFER_SIZE} 条）`, logLevel: 'warn' });
				}
				// 溢出后丢弃新消息
			} else {
				capturedBuffer.push({ message, logLevel, traceFields });
			}
		}
	} catch {
		// 上报器（telemetry 等）内部异常不应冒泡到 console 调用方，
		// 否则会触发 unhandledrejection / onUnexpectedError（"出现未知错误"）
	}
}

/**
 * 注册上报器（渲染进程 telemetry 就绪后调用），并 flush 启动期缓冲。
 */
export function registerRendererLogCaptureReporter(rendererReporter: RendererLogCaptureReporter): void {
	if (reporter) {
		return;
	}
	reporter = rendererReporter;
	if (capturedBuffer.length > 0) {
		const flush = capturedBuffer.splice(0);
		for (const item of flush) {
			sendToReporter(item.message, item.logLevel, item.traceFields);
		}
	}
}

/**
 * 安装渲染进程 console 截获（仅当 capturedLog.logSourceEnabled 含 'renderer' 时由入口调用）。
 * @param traceEnabledParam capturedLog.traceEnabled：trace 字段计算下沉开关（关闭时跳过）。
 * @param logLevelEnabledParam capturedLog.logLevelEnabled：级别过滤名单（'all' | 级别数组 |
 *   undefined）。未配置或无效时全部屏蔽；过滤先于 trace 推进（被过滤日志不占 traceIndex）。
 */
export function installRendererLogCapture(traceEnabledParam: boolean, logLevelEnabledParam: string | readonly string[] | undefined): void {
	if ((console as unknown as { __testWorkbenchRendererLogCaptureInstalled?: boolean }).__testWorkbenchRendererLogCaptureInstalled) {
		return;
	}
	(console as unknown as { __testWorkbenchRendererLogCaptureInstalled: boolean }).__testWorkbenchRendererLogCaptureInstalled = true;
	traceEnabled = traceEnabledParam;
	logLevelEnabled = logLevelEnabledParam === 'all' ? 'all'
		: Array.isArray(logLevelEnabledParam) ? new Set(logLevelEnabledParam) : undefined;

	// 注意：不同 Electron/Chromium 环境（含部分平台）不一定提供 timeLog/timeEnd/count/table/dir 等方法，
	// 直接 .bind() 会在启动阶段抛 TypeError（导致 "出现未知错误"），故统一判空、缺失时置为 undefined。
	const nativeConsole: Record<string, ((...args: any[]) => void) | undefined> = {
		log: typeof console.log === 'function' ? console.log.bind(console) : undefined,
		info: typeof console.info === 'function' ? console.info.bind(console) : undefined,
		warn: typeof console.warn === 'function' ? console.warn.bind(console) : undefined,
		error: typeof console.error === 'function' ? console.error.bind(console) : undefined,
		debug: typeof console.debug === 'function' ? console.debug.bind(console) : undefined,
		trace: typeof console.trace === 'function' ? console.trace.bind(console) : undefined,
		dir: typeof console.dir === 'function' ? console.dir.bind(console) : undefined,
		assert: typeof console.assert === 'function' ? console.assert.bind(console) : undefined,
		table: typeof console.table === 'function' ? console.table.bind(console) : undefined,
		count: typeof console.count === 'function' ? console.count.bind(console) : undefined,
		timeLog: typeof console.timeLog === 'function' ? console.timeLog.bind(console) : undefined,
		timeEnd: typeof console.timeEnd === 'function' ? console.timeEnd.bind(console) : undefined
	};

	// 方法 → logLevel 映射（与 extensionHost / webview 链路语义一致）
	const methodToLogLevel = (method: string): string => {
		if (method === 'error') {
			return 'error';
		}
		if (method === 'assert') {
			return 'warn'; // 原生 console.assert 语义为警告级别，与 webview/extensionHost 链路统一
		}
		if (method === 'warn') {
			return 'warn';
		}
		if (method === 'debug') {
			return 'debug';
		}
		if (method === 'trace') {
			return 'trace';
		}
		return 'info';
	};

	// 常规方法：保留原生行为 + 截获上报（环境不支持的方法自动跳过，避免启动时报错）
	for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table', 'count', 'timeLog', 'timeEnd']) {
		const native = nativeConsole[method];
		if (typeof native !== 'function') {
			continue;
		}
		(console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
			try {
				native(...args);
			} catch {
				// 原生 console 方法（如部分环境下 timeLog/count 等）可能抛错，
				// 此处吞掉避免错误冒泡到调用方（否则会触发 "出现未知错误"）
			}
			// 链路追踪（capturedLog 第二阶段）：产生侧按本次调用栈指纹推进 trace 状态；
			// traceEnabled 下沉：关闭时跳过 new Error().stack 与状态机推进；
			// 级别过滤（logLevelEnabled）：被过滤级别不推进 trace（不占 traceIndex）且不上报
			logToReporter(argsToString(args), methodToLogLevel(method), () => traceEnabled ? traceContext.next(extractStackKey(new Error().stack)) : undefined);
		};
	}

	// console.assert 签名特殊：第一个参数是断言条件而非输出内容，
	// 断言成功时无输出、仅失败时输出 warn 级消息（与原生 assert 语义一致），故单独处理。
	const nativeAssert = nativeConsole.assert;
	if (typeof nativeAssert === 'function') {
		(console as unknown as Record<string, (...args: unknown[]) => void>).assert = (condition: unknown, ...args: unknown[]) => {
			try {
				nativeAssert(condition, ...args);
			} catch {
				// 同上：原生 console.assert 异常时忽略
			}
		if (!condition) {
			// assert 失败固定 warn 级（与 README 映射表一致），级别过滤逻辑同上方循环
			logToReporter(args.length > 0 ? ('Assertion failed: ' + argsToString(args)) : 'Assertion failed', 'warn', () => traceEnabled ? traceContext.next(extractStackKey(new Error().stack)) : undefined);
		}
	};
}

	// 未捕获异常 / 未处理的 Promise rejection（DevTools 可见的错误输出）。
	// 链路追踪（capturedLog 第二阶段）：指纹取错误对象自身栈（错误产生位置的调用路径），
	// 非 Error 时无指纹（仅按时间窗判定流程边界）。
	window.addEventListener('error', (event) => {
		let detail = event.message;
		if (event.error && typeof event.error.stack === 'string') {
			detail = event.error.stack;
		}
		// error 事件固定 error 级，级别过滤逻辑同上方循环（不占 traceIndex）
		logToReporter('Uncaught Error: ' + detail, 'error', () => traceEnabled ? traceContext.next(extractStackKey(event.error && typeof event.error.stack === 'string' ? event.error.stack : undefined)) : undefined);
	});
	window.addEventListener('unhandledrejection', (event) => {
		let reason = '';
		try {
			reason = typeof event.reason === 'string' ? event.reason : JSON.stringify(event.reason);
		} catch {
			reason = String(event.reason);
		}
		// unhandledrejection 固定 error 级，级别过滤逻辑同上方循环（不占 traceIndex）
		logToReporter('Unhandled Promise Rejection: ' + reason, 'error', () => traceEnabled ? traceContext.next(extractStackKey(event.reason instanceof Error ? event.reason.stack : undefined)) : undefined);
	});
}

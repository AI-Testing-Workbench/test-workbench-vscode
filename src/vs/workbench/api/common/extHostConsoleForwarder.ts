/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change start
import { IRemoteConsoleLog, IStackArgument } from '../../../base/common/console.js';
// test-workbench_change end
import { safeStringify } from '../../../base/common/objects.js';
// test-workbench_change start
import { URI } from '../../../base/common/uri.js';
import { ExtensionPaths, IExtHostExtensionService } from './extHostExtensionService.js';
// test-workbench_change end
import { MainContext, MainThreadConsoleShape } from './extHost.protocol.js';
import { IExtHostInitDataService } from './extHostInitDataService.js';
import { IExtHostRpcService } from './extHostRpcService.js';
// test-workbench_change start
import { getCurrentConsoleStack } from './consoleCaptureShared.js';
// test-workbench_change end
// test-workbench_change start
import { extractStackKey, extensionHostTraceContext } from '../../../base/common/traceContext.js';
// test-workbench_change end

// test-workbench_change start
/**
 * 携带 telemetry 上报信息的日志消息（IRemoteConsoleLog 的 fork 扩展）。
 * reportToTelemetry 标记原始插件 console 调用（区别于“已截获日志”验证消息）；
 * extensionId 为扩展宿主侧调用栈反查出的所属扩展标识；
 * traceId/traceIndex 为链路追踪字段（capturedLog 第二阶段，产生侧赋值）。
 */
export interface ITelemetryConsoleLog extends IRemoteConsoleLog {
	reportToTelemetry?: boolean;
	extensionId?: string;
	extensionVersion?: string;
	traceId?: string;
	traceIndex?: number;
}
// test-workbench_change end

// test-workbench_change start
// 链路追踪状态机（capturedLog 第二阶段）：同一扩展同一次业务处理流程的日志共享 traceId，
// traceIndex 从 1 开始递增编号（同 traceId 内按产生顺序排序）。
// 产生侧（本进程）维护，随 RPC 消息传递给渲染进程。
// 单例 extensionHostTraceContext 与 resetTraceContext 定义在 traceContext.ts
// （避免 extHostCommands ⇄ 本模块 ⇄ extHostExtensionService 的循环依赖）。
// test-workbench_change end

export abstract class AbstractExtHostConsoleForwarder {

	private readonly _mainThreadConsole: MainThreadConsoleShape;
	private readonly _includeStack: boolean;
	// test-workbench_change start
	// 扩展路径前缀索引（文件名 -> 扩展描述），用于从调用栈反查“当前日志出自哪个扩展”。
	private _extensionPaths: ExtensionPaths | undefined;
	// test-workbench_change end
	// test-workbench_change start
	// capturedLog 产生侧配置（渲染进程从 product.json 合成后经 initData 传入，见 IExtensionHostInitData.capturedLog）：
	// - _capturedLogSourceEnabled：capturedLog.logSourceEnabled 是否含 'extensionHost'
	// - _traceEnabled：capturedLog.traceEnabled
	// - _extensionIdMode / _extensionIdSet：capturedLog.extensionIdEnabled 名单（'all' | 指定扩展集合 | none）
	// - _logLevelMode / _logLevelSet：capturedLog.logLevelEnabled 级别名单（'all' | 指定级别集合 | none），
	//   过滤判断在 trace 状态机推进（next）之前完成，被过滤日志不占 traceIndex（编号连续）
	// 关闭时（默认）跳过调用栈反查与 trace 计算，与改动前（无 capturedLog trace 功能）行为一致。
	private readonly _capturedLogSourceEnabled: boolean;
	private readonly _traceEnabled: boolean;
	private readonly _extensionIdMode: 'all' | 'set' | 'none';
	private readonly _extensionIdSet: Set<string> | undefined;
	private readonly _logLevelMode: 'all' | 'set' | 'none';
	private readonly _logLevelSet: Set<string> | undefined;
	// test-workbench_change end

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
		// test-workbench_change start
		@IExtHostExtensionService extHostExtensionService: IExtHostExtensionService,
		// test-workbench_change end
	) {
		this._mainThreadConsole = extHostRpc.getProxy(MainContext.MainThreadConsole);
		this._includeStack = initData.consoleForward.includeStack;
		// test-workbench_change start
		// capturedLog 产生侧合成配置初始化（见字段注释）。remote / web worker 等未提供
		// initData.capturedLog 的场景，_capturedLogSourceEnabled / _traceEnabled 均为 false（关闭），
		// _logLevelMode 为 'none'（全部屏蔽）。
		const capturedLogConfig = initData.capturedLog;
		this._capturedLogSourceEnabled = capturedLogConfig?.logSourceEnabled === true;
		this._traceEnabled = capturedLogConfig?.traceEnabled === true;
		if (capturedLogConfig?.extensionIdEnabled === 'all') {
			this._extensionIdMode = 'all';
			this._extensionIdSet = undefined;
		} else if (Array.isArray(capturedLogConfig?.extensionIdEnabled)) {
			this._extensionIdMode = 'set';
			this._extensionIdSet = new Set(capturedLogConfig.extensionIdEnabled);
		} else {
			this._extensionIdMode = 'none';
			this._extensionIdSet = undefined;
		}
		if (capturedLogConfig?.logLevelEnabled === 'all') {
			this._logLevelMode = 'all';
			this._logLevelSet = undefined;
		} else if (Array.isArray(capturedLogConfig?.logLevelEnabled)) {
			this._logLevelMode = 'set';
			this._logLevelSet = new Set(capturedLogConfig.logLevelEnabled);
		} else {
			this._logLevelMode = 'none';
			this._logLevelSet = undefined;
		}
		// test-workbench_change end
		// test-workbench_change start
		// 预构建扩展路径索引（异步）。扩展激活后的插件 console 调用发生时索引基本已就绪；
		// 未就绪时 _findExtensionInfo 返回 undefined（此时 extensionId / extensionVersion 不上报）。
		extHostExtensionService.getExtensionPathIndex().then(index => {
			this._extensionPaths = index;
		}).catch(() => {
			this._extensionPaths = undefined;
		});
		// test-workbench_change end

		// Pass console logging to the outside so that we have it in the main side if told so
		this._wrapConsoleMethod('info', 'log');
		this._wrapConsoleMethod('log', 'log');
		this._wrapConsoleMethod('warn', 'warn');
		this._wrapConsoleMethod('debug', 'debug');
		this._wrapConsoleMethod('error', 'error');
	}

	/**
	 * Wraps a console message so that it is transmitted to the renderer. If
	 * native logging is turned on, the original console message will be written
	 * as well. This is needed since the console methods are "magic" in V8 and
	 * are the only methods that allow later introspection of logged variables.
	 *
	 * The wrapped property is not defined with `writable: false` to avoid
	 * throwing errors, but rather a no-op setting. See https://github.com/microsoft/vscode-extension-telemetry/issues/88
	 */
	private _wrapConsoleMethod(method: 'log' | 'info' | 'warn' | 'error' | 'debug', severity: 'log' | 'warn' | 'error' | 'debug') {
		const that = this;
		const original = console[method];

		Object.defineProperty(console, method, {
			set: () => { },
			get: () => (...args: unknown[]) => {
				that._handleConsoleCall(method, severity, original, args);
			},
		});
	}

	private _handleConsoleCall(method: 'log' | 'info' | 'warn' | 'error' | 'debug', severity: 'log' | 'warn' | 'error' | 'debug', original: (...args: unknown[]) => void, args: unknown[]): void {
		// test-workbench_change start
		// capturedLog 产生侧下沉（logSourceEnabled / extensionIdEnabled / logLevelEnabled / traceEnabled，见字段注释）：
		// - 级别过滤（logLevelEnabled，方案 2）先于一切产生侧计算：被过滤级别跳过栈捕获、extensionId
		//   反查与 trace 推进（不占 traceIndex，上报编号连续），reportToTelemetry 置 false 仅影响上报；
		//   $logExtensionHostMessage 照常发送（DevTools “Extension Host”镜像保留）、
		//   _nativeConsoleLogMessage 照常调用（插件进程原生 stdout/stderr 保留）——控制台/输出通道显示零变化。
		// - logSourceEnabled('extensionHost') 关闭或无有效 extensionIdEnabled 名单时，直接跳过调用栈
		//   反查（省去每次 console 调用的栈捕获与扩展路径匹配），上报字段保持 undefined；
		// - 名单过滤同步在产生侧完成（与渲染进程 isCapturedExtensionIdEnabled 语义一致）；
		// - traceEnabled 关闭时跳过 trace 状态机推进与 RPC 字段（与改动前行为一致）。
		// 优先使用共享通道中的“待匹配栈”（unhandledRejection 等异步场景由
		// extensionHostProcess.ts 写入被 reject 的 Error 对象栈），否则回退到当前调用栈。
		const levelAllowed = this._isLogLevelAllowed(severity);
		const pendingStack = levelAllowed ? getCurrentConsoleStack() : undefined;
		const extensionInfo = (levelAllowed && this._capturedLogSourceEnabled && this._extensionIdMode !== 'none')
			? this._findExtensionInfo(pendingStack)
			: undefined;
		const extensionId = extensionInfo?.extensionId;
		const extensionVersion = extensionInfo?.extensionVersion;
		const eligible = levelAllowed && this._isExtensionEligible(extensionId);
		// 链路追踪（capturedLog 第二阶段）：仅在日志归属扩展、级别放行且 traceEnabled 开启时生成 trace 字段。
		// 被过滤级别不调用 next（不占 traceIndex）；共享通道存在“待匹配栈”说明是 unhandledRejection
		// 等异步跨命令边界场景（命令边界 resetTraceContext 已清空当前状态）：优先恢复最近活跃 trace，
		// 与产生该 rejection 的业务流程共享 traceId；否则按调用路径指纹 + 时间窗聚合。
		const traceFields = eligible && this._traceEnabled
			? (pendingStack
				? (extensionHostTraceContext.resumeLastTrace() ?? extensionHostTraceContext.next(extractStackKey(pendingStack)))
				: extensionHostTraceContext.next(extractStackKey(new Error().stack)))
			: undefined;
		// 原始消息附带 telemetry 上报标记、extensionId 与 extensionVersion：渲染进程 mainThreadConsole
		// 收到后直接用渲染进程 TelemetryService 上报 capturedLog（与 extensionActivationTimes
		// 等日志同一实例、同一 session，天然携带 common.userId 等通用属性，无需跨进程同步）。
		// traceId/traceIndex 在产生侧（本进程）赋值，随 RPC 消息传递；
		// 渲染进程是否携带上报由 capturedLog.traceEnabled 开关决定。
		// reportToTelemetry 为级别过滤的结果（方案 2）：被过滤级别不上报，但消息本身照常发送。
		const message: ITelemetryConsoleLog = {
			type: '__$console',
			severity,
			arguments: safeStringifyArgumentsToArray(args, this._includeStack),
			reportToTelemetry: levelAllowed,
			extensionId: eligible ? extensionId : undefined,
			extensionVersion: eligible ? extensionVersion : undefined,
			...(traceFields ?? {})
		};
		this._mainThreadConsole.$logExtensionHostMessage(message);
		// test-workbench_change end
		// test-workbench_change start
		// 追加发送一条“已截获日志”消息，使其能直接显示在 DevTools 控制台与“Extension Host”输出通道中。
		// 说明：插件 console 的原生输出由 _nativeConsoleLogMessage 写入 stdout/stderr，落在
		// NativeLogMarkers 标记内，被渲染进程 _handleProcessOutputStream 过滤，界面上不可见；
		// 因此额外通过 RPC 通道上报一条，用于验证截获成功（后续对接后台日志系统时可按需移除）。
		// this._mainThreadConsole.$logExtensionHostMessage({
		// 	type: '__$console',
		// 	severity,
		// 	arguments: safeStringifyArgumentsToArray([`[已截获日志:${method}] ${consoleArgsToString(args)}`], this._includeStack)
		// });
		// 调用原始 console 方法输出到 stdout/stderr（NativeLogMarkers 包裹），
		// 保证在 logNative=false 的正常模式下也能截获所有插件 console 输出。
		this._nativeConsoleLogMessage(method, original, args);
		// test-workbench_change end
	}

	// test-workbench_change start
	/**
	 * 根据调用栈反查“当前日志出自哪个扩展”。
	 * 原理：扩展宿主进程同时运行多个扩展，console 不携带扩展身份；借助
	 * getExtensionPathIndex 构建的“扩展目录前缀”索引，遍历调用栈帧里的文件路径进行匹配。
	 * 与 extensionHostMain.ts 的 prepareStackTraceAndFindExtension 机制一致。
	 * @param extraStack 可选的额外调用栈（如 unhandledRejection 中被 reject 的 Error 对象栈，
	 * 含插件文件路径），优先于 new Error().stack 参与匹配。
	 * 返回扩展标识与版本号（如 { extensionId: 'test-tech.hello-plugin-sample', extensionVersion: '0.0.1' }），
	 * 匹配不到时返回 undefined。
	 */
	private _findExtensionInfo(extraStack?: string): { extensionId: string; extensionVersion: string } | undefined {
		if (!this._extensionPaths) {
			return undefined;
		}
		const stacks: string[] = [];
		if (extraStack) {
			stacks.push(extraStack);
		}
		const currentStack = new Error().stack;
		if (currentStack) {
			stacks.push(currentStack);
		}
		for (const stack of stacks) {
			for (const line of stack.split('\n')) {
				const trimmed = line.trim();
				// 形如：at foo (c:\path\extension.js:19:24) / at foo (file:///c:/path/extension.js:19:24) / at c:\path\extension.js:19:24
				const parenMatch = /\(([^()]+):\d+:\d+\)$/.exec(trimmed);
				const bareMatch = /at ([^ (]+):\d+:\d+$/.exec(trimmed);
				const file = parenMatch?.[1] ?? bareMatch?.[1];
				if (!file) {
					continue;
				}
				let fileUri: URI;
				if (file.startsWith('file://')) {
					fileUri = URI.parse(file);
				} else {
					fileUri = URI.file(file);
				}
				const extension = this._extensionPaths.findSubstr(fileUri);
				if (extension) {
					return { extensionId: extension.identifier.value, extensionVersion: extension.version };
				}
			}
		}
		return undefined;
	}
	// test-workbench_change end

	// test-workbench_change start
	/**
	 * capturedLog.extensionIdEnabled 名单过滤（下沉到产生侧），与渲染进程
	 * isCapturedExtensionIdEnabled 语义一致：
	 * - 'all'：任何已反查到 extensionId 的日志均可上报；
	 * - 指定扩展集合：仅名单内扩展可上报；
	 * - 无名单：全部不上报。
	 */
	private _isExtensionEligible(extensionId: string | undefined): boolean {
		if (!this._capturedLogSourceEnabled) {
			return false;
		}
		if (this._extensionIdMode === 'all') {
			return !!extensionId;
		}
		if (this._extensionIdMode === 'set') {
			return extensionId ? this._extensionIdSet!.has(extensionId) : false;
		}
		return false;
	}

	/**
	 * capturedLog.logLevelEnabled 级别过滤（下沉到产生侧，与渲染进程 isCapturedLogLevelEnabled
	 * 语义一致）：'all' 全放行；指定级别集合仅集合内放行；无名单全部屏蔽。
	 * 注意：该判断在 trace 状态机推进（next）之前完成，被过滤日志不占 traceIndex（编号连续）。
	 * severity 与 logLevel 的对应关系与渲染进程 mainThreadConsole 消费侧一致（log/info → info）。
	 */
	private _isLogLevelAllowed(severity: 'log' | 'warn' | 'error' | 'debug'): boolean {
		if (this._logLevelMode === 'all') {
			return true;
		}
		if (this._logLevelMode === 'set') {
			return this._logLevelSet!.has(severity === 'log' ? 'info' : severity);
		}
		return false;
	}
	// test-workbench_change end

	protected abstract _nativeConsoleLogMessage(method: 'log' | 'info' | 'warn' | 'error' | 'debug', original: (...args: unknown[]) => void, args: unknown[]): void;

}

const MAX_LENGTH = 100000;

/**
 * Prevent circular stringify and convert arguments to real array
 */
function safeStringifyArgumentsToArray(args: unknown[], includeStack: boolean): string {
	const argsArray = [];

	// Massage some arguments with special treatment
	if (args.length) {
		for (let i = 0; i < args.length; i++) {
			let arg = args[i];

			// Any argument of type 'undefined' needs to be specially treated because
			// JSON.stringify will simply ignore those. We replace them with the string
			// 'undefined' which is not 100% right, but good enough to be logged to console
			if (typeof arg === 'undefined') {
				arg = 'undefined';
			}

			// Any argument that is an Error will be changed to be just the error stack/message
			// itself because currently cannot serialize the error over entirely.
			else if (arg instanceof Error) {
				const errorObj = arg;
				if (errorObj.stack) {
					arg = errorObj.stack;
				} else {
					arg = errorObj.toString();
				}
			}

			argsArray.push(arg);
		}
	}

	// Add the stack trace as payload if we are told so. We remove the message and the 2 top frames
	// to start the stacktrace where the console message was being written
	if (includeStack) {
		const stack = new Error().stack;
		if (stack) {
			argsArray.push({ __$stack: stack.split('\n').slice(3).join('\n') } satisfies IStackArgument);
		}
	}

	try {
		const res = safeStringify(argsArray);

		if (res.length > MAX_LENGTH) {
			return 'Output omitted for a large object that exceeds the limits';
		}

		return res;
	} catch (error) {
		return `Output omitted for an object that cannot be inspected ('${error.toString()}')`;
	}
}

// test-workbench_change start
// consoleArgsToString 仅服务于“已截获日志”验证消息，该消息已注释，函数一并停用。
// /**
//  * Formats console arguments into a single string for the "已截获日志" verification message.
//  */
// function consoleArgsToString(args: unknown[]): string {
// 	return args.map((arg) => {
// 		if (typeof arg === 'string') {
// 			return arg;
// 		}
// 		if (arg instanceof Error) {
// 			return arg.stack ?? `${arg.name}: ${arg.message}`;
// 		}
// 		try {
// 			return JSON.stringify(arg);
// 		} catch {
// 			return String(arg);
// 		}
// 	}).join(' ');
// }
// test-workbench_change end

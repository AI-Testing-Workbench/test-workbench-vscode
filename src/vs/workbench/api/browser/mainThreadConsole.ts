/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { MainContext, MainThreadConsoleShape } from '../common/extHost.protocol.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
// test-workbench_change start
import { IRemoteConsoleLog, log, parse } from '../../../base/common/console.js';
// test-workbench_change end
import { logRemoteEntry, logRemoteEntryIfError } from '../../services/extensions/common/remoteConsoleUtil.js';
import { parseExtensionDevOptions } from '../../services/extensions/common/extensionDevOptions.js';
import { ILogService } from '../../../platform/log/common/log.js';
// test-workbench_change start
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { TelemetryTrustedValue } from '../../../platform/telemetry/common/telemetryUtils.js';
import { IProductService, isCapturedLogSourceEnabled, isCapturedExtensionIdEnabled, isCapturedLogTraceEnabled, isCapturedLogLevelEnabled } from '../../../platform/product/common/productService.js';
// test-workbench_change end

// test-workbench_change start
// 方案 1 去重：与 rendererLogCapture.ts 约定同一个 console 属性作为"抑制标记"。
// mainThreadConsole 对已按 extensionHost 源上报的扩展宿主消息，在写渲染进程 console 时
// 置位该标记，rendererLogCapture hook 检测到即跳过上报（原生 console 行为不受影响）。
function setRendererLogCaptureSuppressed(suppressed: boolean): void {
	(console as unknown as { __testWorkbenchSuppressRendererLogCapture?: boolean }).__testWorkbenchSuppressRendererLogCapture = suppressed;
}
// test-workbench_change end

@extHostNamedCustomer(MainContext.MainThreadConsole)
export class MainThreadConsole implements MainThreadConsoleShape {

	private readonly _isExtensionDevTestFromCli: boolean;

	constructor(
		_extHostContext: IExtHostContext,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@ILogService private readonly _logService: ILogService,
		// test-workbench_change start
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IProductService private readonly _productService: IProductService,
		// test-workbench_change end
	) {
		const devOpts = parseExtensionDevOptions(this._environmentService);
		this._isExtensionDevTestFromCli = devOpts.isExtensionDevTestFromCli;
	}

	dispose(): void {
		//
	}

	$logExtensionHostMessage(entry: IRemoteConsoleLog): void {
		// test-workbench_change start
		// 方案 B：capturedLog 由渲染进程 TelemetryService 上报。extensionHost 侧在原始
		// __$console 消息上带 reportToTelemetry + extensionId + extensionVersion 标记；此处复用现有 RPC
		// 通道，直接用渲染进程实例 publicLog（与 extensionActivationTimes 等日志同一实例、
		// 同一 session，天然携带 common.userId / common.userName / common.pathName 等属性）。
		// 配置开关：product.json 的 capturedLog.logSourceEnabled 不含 'extensionHost' 时，
		// 直接终止 telemetry 上报流程（RPC 消息仍会到达，但不再产生 capturedLog 事件）。
		// 配置维度：capturedLog.extensionIdEnabled 决定该 extensionId 是否上报
		// （与 logSourceEnabled 为 AND 关系），不满足时同样终止上报。
		// 配置维度：capturedLog.logLevelEnabled 决定该级别是否上报（与 logSourceEnabled /
		// extensionIdEnabled 为 AND 关系），此处作为消费侧兜底（旧版本 extensionHost 进程
		// 未做产生侧过滤时，仍能拦住被过滤级别的上报）。
		const telemetryEntry = entry as IRemoteConsoleLog & { reportToTelemetry?: boolean; extensionId?: string; extensionVersion?: string; traceId?: string; traceIndex?: number };
		const logLevel = telemetryEntry.severity === 'error' ? 'error'
			: telemetryEntry.severity === 'warn' ? 'warn'
				: telemetryEntry.severity === 'debug' ? 'debug' : 'info';
		let suppressRendererLogCapture = false; // 方案 1 去重：已按 extensionHost 源上报，需抑制 renderer 源重复
		if (telemetryEntry.reportToTelemetry && isCapturedLogSourceEnabled(this._productService, 'extensionHost') && isCapturedExtensionIdEnabled(this._productService, telemetryEntry.extensionId) && isCapturedLogLevelEnabled(this._productService, logLevel)) {
			const message = parse(entry).args.map((arg) => {
				if (typeof arg === 'string') {
					return arg;
				}
				try {
					return JSON.stringify(arg);
				} catch {
					return String(arg);
				}
			}).join(' ');
			this._telemetryService.publicLog('capturedLog', {
				message: new TelemetryTrustedValue(message),
				logSource: 'extensionHost',
				logLevel,
				...(telemetryEntry.extensionId ? { extensionId: telemetryEntry.extensionId } : {}),
				...(telemetryEntry.extensionVersion ? { extensionVersion: telemetryEntry.extensionVersion } : {}),
				// 链路追踪（capturedLog 第二阶段）：traceId/traceIndex 由扩展宿主
				// 产生侧赋值并随 RPC 消息传递；此处仅在 capturedLog.traceEnabled 开启、
				// 且两字段同时存在时携带上报。traceId 与 traceIndex 必须成对出现，
				// 否则（traceIndex 为 undefined 时 JSON 序列化会丢弃该字段）会产生
				// "只有 traceId 没有 traceIndex"的残缺事件。
				...(isCapturedLogTraceEnabled(this._productService) && telemetryEntry.traceId && typeof telemetryEntry.traceIndex === 'number' ? { traceId: telemetryEntry.traceId, traceIndex: telemetryEntry.traceIndex } : {}),
			});
			// 方案 1 去重：本消息已按 extensionHost 源上报（带 extensionId，信息更全），
			// 写 console 时抑制 renderer 源对同一消息的重复上报。
			suppressRendererLogCapture = true;
		}
		// test-workbench_change end
		// test-workbench_change start
		// 方案 1 去重：抑制窗口覆盖本 entry 写入渲染进程 console 的全过程（log() 及
		// ILogService 的 console 输出）。同步执行、finally 必清，标志不会残留。
		try {
			if (suppressRendererLogCapture) {
				setRendererLogCaptureSuppressed(true);
			}
			// test-workbench_change end
			if (this._isExtensionDevTestFromCli) {
				// If running tests from cli, log to the log service everything
				logRemoteEntry(this._logService, entry);
			} else {
				// Log to the log service only errors and log everything to local console
				logRemoteEntryIfError(this._logService, entry, 'Extension Host');
				log(entry, 'Extension Host');
			}
			// test-workbench_change start
		} finally {
			setRendererLogCaptureSuppressed(false);
		}
		// test-workbench_change end
	}
}

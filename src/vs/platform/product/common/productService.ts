/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductConfiguration } from '../../../base/common/product.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IProductService = createDecorator<IProductService>('productService');

export interface IProductService extends Readonly<IProductConfiguration> {

	readonly _serviceBrand: undefined;

}

export const productSchemaId = 'vscode://schemas/vscode-product';

// test-workbench_change start
/**
 * 判断某个 logSource 是否启用了 capturedLog 日志截获与上报。
 * product.json 中 capturedLog.logSourceEnabled 存在且为有效数组时，仅数组内列出的
 * logSource 启用；配置为字符串 all 时对所有 logSource 启用；其他情况（未配置或
 * 配置无效）时默认对所有 logSource 关闭。
 */
export function isCapturedLogSourceEnabled(productService: IProductService, logSource: string): boolean {
	const logSourceEnabled = productService.capturedLog?.logSourceEnabled;
	if (Array.isArray(logSourceEnabled)) {
		return logSourceEnabled.includes(logSource);
	}
	return logSourceEnabled === 'all';
}

/**
 * 判断某个 extensionId 是否启用了 capturedLog 日志截获与上报（与 isCapturedLogSourceEnabled 为 AND 关系）。
 * product.json 中 capturedLog.extensionIdEnabled 存在且为有效数组时，仅数组内列出的
 * extensionId 启用；配置为字符串 all 时对 extensionId 的值不为 undefined、null、
 * 空字符串时启用；其他情况（未配置或配置无效）时默认对所有 extensionId 关闭。
 */
export function isCapturedExtensionIdEnabled(productService: IProductService, extensionId: string | null | undefined): boolean {
	const extensionIdEnabled = productService.capturedLog?.extensionIdEnabled;
	if (Array.isArray(extensionIdEnabled)) {
		return typeof extensionId === 'string' && extensionIdEnabled.includes(extensionId);
	}
	if (extensionIdEnabled === 'all') {
		return typeof extensionId === 'string' && extensionId.length > 0;
	}
	return false;
}

/**
 * 判断某个 outputChannelName 是否启用了 capturedLog 日志截获与上报。
 * 仅用于 logSource='outputChannel' 链路：product.json 中 capturedLog.outputChannelNameEnabled
 * 存在且为有效数组时，仅数组内列出的 outputChannelName 启用；配置为字符串 all 时对所有
 * outputChannelName 启用；其他情况（未配置或配置无效）时默认对所有 outputChannelName 关闭。
 */
export function isCapturedOutputChannelNameEnabled(productService: IProductService, outputChannelName: string | null | undefined): boolean {
	const outputChannelNameEnabled = productService.capturedLog?.outputChannelNameEnabled;
	if (Array.isArray(outputChannelNameEnabled)) {
		return typeof outputChannelName === 'string' && outputChannelNameEnabled.includes(outputChannelName);
	}
	return outputChannelNameEnabled === 'all';
}

/**
 * 判断链路追踪是否启用（capturedLog 第二阶段，traceId/traceIndex）。
 * product.json 中 capturedLog.traceEnabled 为 true 时启用；其他情况（未配置或为 false）时关闭。
 * traceId/traceIndex 由各 logSource 截获点在产生侧赋值后随消息传递；
 * 此开关控制上报 capturedLog 事件时是否携带这些链路字段（关闭时上报事件与不开启链路追踪时完全一致）。
 */
export function isCapturedLogTraceEnabled(productService: IProductService): boolean {
	return productService.capturedLog?.traceEnabled === true;
}

/**
 * 判断某个 logLevel 是否允许 capturedLog 上报（四条链路统一应用，与 logSourceEnabled /
 * extensionIdEnabled / outputChannelNameEnabled 均为 AND 关系）。
 * product.json 中 capturedLog.logLevelEnabled 为字符串 all 时所有级别放行；
 * 为有效数组时仅数组内列出的级别（info/warn/error/debug/trace）放行；
 * 其他情况（未配置或配置无效）时默认全部屏蔽。
 * 注意：过滤判断须放在各链路 trace 状态机推进（next）之前，被过滤日志不占 traceIndex。
 */
export function isCapturedLogLevelEnabled(productService: IProductService, logLevel: string | null | undefined): boolean {
	const logLevelEnabled = productService.capturedLog?.logLevelEnabled;
	if (Array.isArray(logLevelEnabled)) {
		return typeof logLevel === 'string' && logLevelEnabled.includes(logLevel);
	}
	return logLevelEnabled === 'all';
}
// test-workbench_change end

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
// 扩展宿主 console 截获链路内部共享的“待匹配调用栈”。
// 为什么需要共享：
//  - console 是进程级全局对象，扩展宿主同时运行多个扩展，console 调用本身不携带扩展身份；
//  - 扩展路径索引（IExtHostExtensionService.getExtensionPathIndex）只在 ExtHost 层可用，
//    extensionHostProcess.ts 的 unhandledRejection 处理器运行在 RPC 初始化之前，无法直接访问；
//  - 调用顺序为：插件 console.log -> extHostConsoleForwarder（推断扩展名）。对于 unhandledRejection
//    等异步场景，new Error().stack 不含插件路径，因此 extensionHostProcess.ts 先把被 reject 的
//    Error 对象栈写入共享通道，再由 extHostConsoleForwarder 在同一同步调用栈内读取匹配。

/**
 * 由 extensionHostProcess.ts 在“非插件同步调用栈”内（如 unhandledRejection 的 setTimeout 回调）
 * 写入待匹配的调用栈（通常是被 reject 的 Error 对象的 stack，其中包含插件文件路径）。
 * 原因：此类场景下 new Error().stack 只含 Node 内部/定时回调帧，不含插件路径，无法反查扩展。
 */
export function setCurrentConsoleStack(stack: string | undefined): void {
	_currentConsoleStack = stack;
}

/**
 * 由 extHostConsoleForwarder（推断层）读取，作为调用栈反查扩展的优先匹配源。
 */
export function getCurrentConsoleStack(): string | undefined {
	return _currentConsoleStack;
}

let _currentConsoleStack: string | undefined = undefined;

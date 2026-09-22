/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Delayer } from '../../../../base/common/async.js';
import { VSBuffer, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';
import { consumeStream } from '../../../../base/common/stream.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
// test-workbench_change start
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
// test-workbench_change end
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
// test-workbench_change start
import { IProductService, isCapturedLogTraceEnabled, isCapturedLogLevelEnabled } from '../../../../platform/product/common/productService.js';
import { ITraceFields } from '../../../../base/common/traceContext.js';
// test-workbench_change end
import { IRemoteAuthorityResolverService } from '../../../../platform/remote/common/remoteAuthorityResolver.js';
// test-workbench_change start
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { TelemetryTrustedValue } from '../../../../platform/telemetry/common/telemetryUtils.js';
// test-workbench_change end
import { ITunnelService } from '../../../../platform/tunnel/common/tunnel.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { FindInFrameOptions, IWebviewManagerService } from '../../../../platform/webview/common/webviewManagerService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { WebviewThemeDataProvider } from '../browser/themeing.js';
import { WebviewInitInfo } from '../browser/webview.js';
import { WebviewElement } from '../browser/webviewElement.js';
import { WindowIgnoreMenuShortcutsManager } from './windowIgnoreMenuShortcutsManager.js';

/**
 * Webview backed by an iframe but that uses Electron APIs to power the webview.
 */
export class ElectronWebviewElement extends WebviewElement {

	private readonly _webviewKeyboardHandler: WindowIgnoreMenuShortcutsManager;

	private _findStarted: boolean = false;
	private _cachedHtmlContent: string | undefined;

	private readonly _webviewMainService: IWebviewManagerService;
	private readonly _iframeDelayer = this._register(new Delayer<void>(200));

	protected override get platform() { return 'electron'; }

	constructor(
		initInfo: WebviewInitInfo,
		webviewThemeDataProvider: WebviewThemeDataProvider,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ITunnelService tunnelService: ITunnelService,
		@IFileService fileService: IFileService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@ILogService logService: ILogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@INotificationService notificationService: INotificationService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		// test-workbench_change start
		@IProductService productService: IProductService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		// test-workbench_change end
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		// test-workbench_change start
		super(initInfo, webviewThemeDataProvider,
			configurationService, contextMenuService, notificationService, environmentService,
			fileService, logService, remoteAuthorityResolverService, tunnelService, instantiationService, accessibilityService, uriIdentityService, productService);
		// test-workbench_change end
		this._webviewKeyboardHandler = new WindowIgnoreMenuShortcutsManager(configurationService, mainProcessService, _nativeHostService);

		this._webviewMainService = ProxyChannel.toService<IWebviewManagerService>(mainProcessService.getChannel('webview'));

		if (initInfo.options.enableFindWidget) {
			this._register(this.onDidHtmlChange((newContent) => {
				if (this._findStarted && this._cachedHtmlContent !== newContent) {
					this.stopFind(false);
					this._cachedHtmlContent = newContent;
				}
			}));

			this._register(this._webviewMainService.onFoundInFrame((result) => {
				this._hasFindResult.fire(result.matches > 0);
			}));
		}
	}

	override dispose(): void {
		// Make sure keyboard handler knows it closed (#71800)
		this._webviewKeyboardHandler.didBlur();

		super.dispose();
	}

	protected override webviewContentEndpoint(iframeId: string): string {
		return `${Schemas.vscodeWebview}://${iframeId}`;
	}

	protected override streamToBuffer(stream: VSBufferReadableStream): Promise<ArrayBufferLike> {
		// Join buffers from stream without using the Node.js backing pool.
		// This lets us transfer the resulting buffer to the webview.
		return consumeStream<VSBuffer, ArrayBufferLike>(stream, (buffers: readonly VSBuffer[]) => {
			const totalLength = buffers.reduce((prev, curr) => prev + curr.byteLength, 0);
			const ret = new ArrayBuffer(totalLength);
			const view = new Uint8Array(ret);
			let offset = 0;
			for (const element of buffers) {
				view.set(element.buffer, offset);
				offset += element.byteLength;
			}
			return ret;
		});
	}

	/**
	 * Webviews expose a stateful find API.
	 * Successive calls to find will move forward or backward through onFindResults
	 * depending on the supplied options.
	 *
	 * @param value The string to search for. Empty strings are ignored.
	 */
	public override find(value: string, previous: boolean): void {
		if (!this.element) {
			return;
		}

		if (!this._findStarted) {
			this.updateFind(value);
		} else {
			// continuing the find, so set findNext to false
			const options: FindInFrameOptions = { forward: !previous, findNext: false, matchCase: false };
			this._webviewMainService.findInFrame({ windowId: this._nativeHostService.windowId }, this.id, value, options);
		}
	}

	public override updateFind(value: string) {
		if (!value || !this.element) {
			return;
		}

		// FindNext must be true for a first request
		const options: FindInFrameOptions = {
			forward: true,
			findNext: true,
			matchCase: false
		};

		this._iframeDelayer.trigger(() => {
			this._findStarted = true;
			this._webviewMainService.findInFrame({ windowId: this._nativeHostService.windowId }, this.id, value, options);
		});
	}

	public override stopFind(keepSelection?: boolean): void {
		if (!this.element) {
			return;
		}
		this._iframeDelayer.cancel();
		this._findStarted = false;
		this._webviewMainService.stopFindInFrame({ windowId: this._nativeHostService.windowId }, this.id, {
			keepSelection
		});
		this._onDidStopFind.fire();
	}

	protected override handleFocusChange(isFocused: boolean): void {
		super.handleFocusChange(isFocused);
		if (isFocused) {
			this._webviewKeyboardHandler.didFocus();
		} else {
			this._webviewKeyboardHandler.didBlur();
		}
	}

	// test-workbench_change start
	// 方案 B：capturedLog 由渲染进程 TelemetryService 上报（与 extensionHost 的 mainThreadConsole 一致，
	// 与 extensionActivationTimes 等日志同一实例、同一 session，天然携带 common.userId / common.userName
	// / common.pathName 等通用属性，无需再经 Electron IPC 转发主进程上报）。
	// extensionId：创建该 webview 的插件 id（webview 在创建时就绑定了归属扩展，天然精确）；
	// extensionVersion：由 IExtensionService 按 extensionId 查询扩展版本（Map 缓存，仅首次异步获取）。
	private readonly _extensionVersionCache = new Map<string, string | undefined>();

	private async _getExtensionVersion(extensionId: string | undefined): Promise<string | undefined> {
		if (!extensionId) {
			return undefined;
		}
		if (this._extensionVersionCache.has(extensionId)) {
			return this._extensionVersionCache.get(extensionId);
		}
		let version: string | undefined;
		try {
			const ext = await this._extensionService.getExtension(extensionId);
			version = ext?.version;
		} catch {
			version = undefined;
		}
		this._extensionVersionCache.set(extensionId, version);
		return version;
	}

	protected override async handleLogCapture(data: string, logLevel: string = 'info', extensionId?: string, traceFields?: ITraceFields): Promise<void> {
		super.handleLogCapture(data, logLevel, extensionId, traceFields);
		// 兜底过滤（方案 2，消费侧）：正常路径下截获脚本已在产生侧过滤（被过滤日志不 postMessage、
		// 不占 traceIndex）；此处防止旧版本 pre 脚本未过滤时漏出，过滤只影响上报，不影响
		// webview 自身 console 显示（native 输出先行，与方案 2 语义一致）。
		if (!isCapturedLogLevelEnabled(this._productService, logLevel)) {
			return;
		}
		const extensionVersion = await this._getExtensionVersion(extensionId);
		// 用 TelemetryTrustedValue 包装，避免 telemetry 清洗逻辑将文件路径等敏感信息替换为 <REDACTED...>
		// 链路追踪（capturedLog 第二阶段）：traceId/traceIndex 由 webview 截获脚本产生侧
		// 赋值并经 pre/index.html 透传；此处仅在 capturedLog.traceEnabled 开启时携带上报。
		this._telemetryService.publicLog('capturedLog', {
			message: new TelemetryTrustedValue(data),
			logSource: 'webview',
			logLevel,
			...(extensionId ? { extensionId } : {}),
			...(extensionVersion ? { extensionVersion } : {}),
			...(isCapturedLogTraceEnabled(this._productService) && traceFields ? { traceId: traceFields.traceId, traceIndex: traceFields.traceIndex } : {})
		});
	}
	// test-workbench_change end
}

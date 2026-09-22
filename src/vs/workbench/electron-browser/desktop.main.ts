/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';
import product from '../../platform/product/common/product.js';
import { INativeWindowConfiguration, IWindowsConfiguration } from '../../platform/window/common/window.js';
import { Workbench } from '../browser/workbench.js';
// test-workbench_change start
import { installRendererLogCapture, registerRendererLogCaptureReporter } from '../contrib/capturedLog/browser/rendererLogCapture.js';
// test-workbench_change end
import { NativeWindow } from './window.js';
import { setFullscreen } from '../../base/browser/browser.js';
import { domContentLoaded } from '../../base/browser/dom.js';
import { onUnexpectedError } from '../../base/common/errors.js';
import { URI } from '../../base/common/uri.js';
import { WorkspaceService } from '../services/configuration/browser/configurationService.js';
import { INativeWorkbenchEnvironmentService, NativeWorkbenchEnvironmentService } from '../services/environment/electron-browser/environmentService.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { ILoggerService, ILogService, LogLevel } from '../../platform/log/common/log.js';
import { NativeWorkbenchStorageService } from '../services/storage/electron-browser/storageService.js';
import { IWorkspaceContextService, isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, IAnyWorkspaceIdentifier, reviveIdentifier, toWorkspaceIdentifier } from '../../platform/workspace/common/workspace.js';
import { IWorkbenchConfigurationService } from '../services/configuration/common/configuration.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { ISharedProcessService } from '../../platform/ipc/electron-browser/services.js';
import { IMainProcessService } from '../../platform/ipc/common/mainProcessService.js';
import { SharedProcessService } from '../services/sharedProcess/electron-browser/sharedProcessService.js';
import { RemoteAuthorityResolverService } from '../../platform/remote/electron-browser/remoteAuthorityResolverService.js';
import { IRemoteAuthorityResolverService, RemoteConnectionType } from '../../platform/remote/common/remoteAuthorityResolver.js';
import { RemoteAgentService } from '../services/remote/electron-browser/remoteAgentService.js';
import { IRemoteAgentService } from '../services/remote/common/remoteAgentService.js';
import { FileService } from '../../platform/files/common/fileService.js';
import { IFileService } from '../../platform/files/common/files.js';
import { RemoteFileSystemProviderClient } from '../services/remote/common/remoteFileSystemProviderClient.js';
import { ConfigurationCache } from '../services/configuration/common/configurationCache.js';
import { ISignService } from '../../platform/sign/common/sign.js';
import { IProductService, isCapturedLogSourceEnabled, isCapturedLogTraceEnabled } from '../../platform/product/common/productService.js';
// test-workbench_change start
import { ITelemetryService } from '../../platform/telemetry/common/telemetry.js';
import { TelemetryTrustedValue } from '../../platform/telemetry/common/telemetryUtils.js';
// test-workbench_change end
import { IUriIdentityService } from '../../platform/uriIdentity/common/uriIdentity.js';
import { UriIdentityService } from '../../platform/uriIdentity/common/uriIdentityService.js';
import { INativeKeyboardLayoutService, NativeKeyboardLayoutService } from '../services/keybinding/electron-browser/nativeKeyboardLayoutService.js';
import { ElectronIPCMainProcessService } from '../../platform/ipc/electron-browser/mainProcessService.js';
import { LoggerChannelClient } from '../../platform/log/common/logIpc.js';
import { ProxyChannel } from '../../base/parts/ipc/common/ipc.js';
import { NativeLogService } from '../services/log/electron-browser/logService.js';
import { WorkspaceTrustEnablementService, WorkspaceTrustManagementService } from '../services/workspaces/common/workspaceTrust.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService } from '../../platform/workspace/common/workspaceTrust.js';
import { safeStringify } from '../../base/common/objects.js';
import { IUtilityProcessWorkerWorkbenchService, UtilityProcessWorkerWorkbenchService } from '../services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';
import { isCI, isMacintosh, isTahoeOrNewer } from '../../base/common/platform.js';
import { Schemas } from '../../base/common/network.js';
import { DiskFileSystemProvider } from '../services/files/electron-browser/diskFileSystemProvider.js';
import { FileUserDataProvider } from '../../platform/userData/common/fileUserDataProvider.js';
import { IUserDataProfilesService, reviveProfile } from '../../platform/userDataProfile/common/userDataProfile.js';
import { UserDataProfilesService } from '../../platform/userDataProfile/common/userDataProfileIpc.js';
import { PolicyChannelClient } from '../../platform/policy/common/policyIpc.js';
import { IPolicyService } from '../../platform/policy/common/policy.js';
import { UserDataProfileService } from '../services/userDataProfile/common/userDataProfileService.js';
import { IUserDataProfileService } from '../services/userDataProfile/common/userDataProfile.js';
import { BrowserSocketFactory } from '../../platform/remote/browser/browserSocketFactory.js';
import { RemoteSocketFactoryService, IRemoteSocketFactoryService } from '../../platform/remote/common/remoteSocketFactoryService.js';
import { ElectronRemoteResourceLoader } from '../../platform/remote/electron-browser/electronRemoteResourceLoader.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { applyZoom } from '../../platform/window/electron-browser/window.js';
import { mainWindow } from '../../base/browser/window.js';
import { IDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';
import { DefaultAccountService } from '../services/accounts/browser/defaultAccount.js';
import { AccountPolicyService } from '../services/policies/common/accountPolicyService.js';
import { MultiplexPolicyService } from '../services/policies/common/multiplexPolicyService.js';

export class DesktopMain extends Disposable {

	constructor(
		private readonly configuration: INativeWindowConfiguration
	) {
		super();

		this.init();
	}

	private init(): void {

		// Massage configuration file URIs
		this.reviveUris();

		// Apply fullscreen early if configured
		setFullscreen(!!this.configuration.fullscreen, mainWindow);
	}

	private reviveUris() {

		// Workspace
		const workspace = reviveIdentifier(this.configuration.workspace);
		if (isWorkspaceIdentifier(workspace) || isSingleFolderWorkspaceIdentifier(workspace)) {
			this.configuration.workspace = workspace;
		}

		// Files
		const filesToWait = this.configuration.filesToWait;
		const filesToWaitPaths = filesToWait?.paths;
		for (const paths of [filesToWaitPaths, this.configuration.filesToOpenOrCreate, this.configuration.filesToDiff, this.configuration.filesToMerge]) {
			if (Array.isArray(paths)) {
				for (const path of paths) {
					if (path.fileUri) {
						path.fileUri = URI.revive(path.fileUri);
					}
				}
			}
		}

		if (filesToWait) {
			filesToWait.waitMarkerFileUri = URI.revive(filesToWait.waitMarkerFileUri);
		}
	}

	async open(): Promise<void> {

		// Init services and wait for DOM to be ready in parallel
		const [services] = await Promise.all([this.initServices(), domContentLoaded(mainWindow)]);

		// Apply zoom level early once we have a configuration service
		// and before the workbench is created to prevent flickering.
		// We also need to respect that zoom level can be configured per
		// workspace, so we need the resolved configuration service.
		// Finally, it is possible for the window to have a custom
		// zoom level that is not derived from settings.
		// (fixes https://github.com/microsoft/vscode/issues/187982)
		this.applyWindowZoomLevel(services.configurationService);

		// Create Workbench
		const workbench = new Workbench(mainWindow.document.body, {
			extraClasses: this.getExtraClasses(),
			resetLayout: this.configuration['disable-layout-restore'] === true
		}, services.serviceCollection, services.logService);

		// Listeners
		this.registerListeners(workbench, services.storageService);

		// Startup
		const instantiationService = workbench.startup();

		// test-workbench_change start
		// 渲染进程核心日志上报：渲染进程 telemetry 就绪后注册上报器，并 flush 启动期缓冲。
		// 仅受 capturedLog.logSourceEnabled 控制（与 extensionIdEnabled / outputChannelNameEnabled 无关）。
		if (isCapturedLogSourceEnabled({ _serviceBrand: undefined, ...product }, 'renderer')) {
			const telemetryService = instantiationService.invokeFunction(accessor => accessor.get(ITelemetryService));
			registerRendererLogCaptureReporter((message, logLevel, traceFields) => {
				// 链路追踪（capturedLog 第二阶段）：traceId/traceIndex 由截获点产生侧
				// 赋值；此处仅在 capturedLog.traceEnabled 开启时携带上报。
				telemetryService.publicLog('capturedLog', {
					message: new TelemetryTrustedValue(message),
					logSource: 'renderer',
					logLevel,
					...(isCapturedLogTraceEnabled({ _serviceBrand: undefined, ...product }) && traceFields ? { traceId: traceFields.traceId, traceIndex: traceFields.traceIndex } : {})
				});
			});
		}
		// test-workbench_change end

		// Window
		this._register(instantiationService.createInstance(NativeWindow));
	}

	private applyWindowZoomLevel(configurationService: IConfigurationService) {
		let zoomLevel: number | undefined = undefined;
		if (this.configuration.isCustomZoomLevel && typeof this.configuration.zoomLevel === 'number') {
			zoomLevel = this.configuration.zoomLevel;
		} else {
			const windowConfig = configurationService.getValue<IWindowsConfiguration>();
			zoomLevel = typeof windowConfig.window?.zoomLevel === 'number' ? windowConfig.window.zoomLevel : 0;
		}

		applyZoom(zoomLevel, mainWindow);
	}

	private getExtraClasses(): string[] {
		if (isMacintosh && isTahoeOrNewer(this.configuration.os.release)) {
			return ['macos-tahoe'];
		}

		return [];
	}

	private registerListeners(workbench: Workbench, storageService: NativeWorkbenchStorageService): void {

		// Workbench Lifecycle
		this._register(workbench.onWillShutdown(event => event.join(storageService.close(), { id: 'join.closeStorage', label: localize('join.closeStorage', "Saving UI state") })));
		this._register(workbench.onDidShutdown(() => this.dispose()));
	}

	private async initServices(): Promise<{ serviceCollection: ServiceCollection; logService: ILogService; storageService: NativeWorkbenchStorageService; configurationService: IConfigurationService }> {
		const serviceCollection = new ServiceCollection();


		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.desktop.main.ts` if the service
		//       is desktop only.
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		// Main Process
		const mainProcessService = this._register(new ElectronIPCMainProcessService(this.configuration.windowId));
		serviceCollection.set(IMainProcessService, mainProcessService);

		// Product
		const productService: IProductService = { _serviceBrand: undefined, ...product };
		serviceCollection.set(IProductService, productService);

		// Environment
		const environmentService = new NativeWorkbenchEnvironmentService(this.configuration, productService);
		serviceCollection.set(INativeWorkbenchEnvironmentService, environmentService);

		// Logger
		const loggers = this.configuration.loggers.map(loggerResource => ({ ...loggerResource, resource: URI.revive(loggerResource.resource) }));
		const loggerService = new LoggerChannelClient(this.configuration.windowId, this.configuration.logLevel, environmentService.windowLogsPath, loggers, mainProcessService.getChannel('logger'));
		serviceCollection.set(ILoggerService, loggerService);

		// Log
		const logService = this._register(new NativeLogService(loggerService, environmentService));
		serviceCollection.set(ILogService, logService);
		if (isCI) {
			logService.info('workbench#open()'); // marking workbench open helps to diagnose flaky integration/smoke tests
		}
		if (logService.getLevel() === LogLevel.Trace) {
			logService.trace('workbench#open(): with configuration', safeStringify({ ...this.configuration, nls: undefined /* exclude large property */ }));
		}

		// Default Account
		const defaultAccountService = this._register(new DefaultAccountService(productService));
		serviceCollection.set(IDefaultAccountService, defaultAccountService);

		// Policies
		let policyService: IPolicyService;
		const accountPolicy = new AccountPolicyService(logService, defaultAccountService);
		if (this.configuration.policiesData) {
			const policyChannel = new PolicyChannelClient(this.configuration.policiesData, mainProcessService.getChannel('policy'));
			policyService = new MultiplexPolicyService([policyChannel, accountPolicy], logService);
		} else {
			policyService = accountPolicy;
		}
		serviceCollection.set(IPolicyService, policyService);

		// Shared Process
		const sharedProcessService = new SharedProcessService(this.configuration.windowId, logService);
		serviceCollection.set(ISharedProcessService, sharedProcessService);

		// Utility Process Worker
		const utilityProcessWorkerWorkbenchService = new UtilityProcessWorkerWorkbenchService(this.configuration.windowId, logService, mainProcessService);
		serviceCollection.set(IUtilityProcessWorkerWorkbenchService, utilityProcessWorkerWorkbenchService);

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.desktop.main.ts` if the service
		//       is desktop only.
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		// Sign
		const signService = ProxyChannel.toService<ISignService>(mainProcessService.getChannel('sign'));
		serviceCollection.set(ISignService, signService);

		// Files
		const fileService = this._register(new FileService(logService));
		serviceCollection.set(IFileService, fileService);

		// Remote
		const remoteAuthorityResolverService = new RemoteAuthorityResolverService(productService, new ElectronRemoteResourceLoader(environmentService.window.id, mainProcessService, fileService));
		serviceCollection.set(IRemoteAuthorityResolverService, remoteAuthorityResolverService);

		// Local Files
		const diskFileSystemProvider = this._register(new DiskFileSystemProvider(mainProcessService, utilityProcessWorkerWorkbenchService, logService, loggerService));
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		// URI Identity
		const uriIdentityService = new UriIdentityService(fileService);
		serviceCollection.set(IUriIdentityService, uriIdentityService);

		// User Data Profiles
		const userDataProfilesService = new UserDataProfilesService(this.configuration.profiles.all, URI.revive(this.configuration.profiles.home).with({ scheme: environmentService.userRoamingDataHome.scheme }), mainProcessService.getChannel('userDataProfiles'));
		serviceCollection.set(IUserDataProfilesService, userDataProfilesService);
		const userDataProfileService = new UserDataProfileService(reviveProfile(this.configuration.profiles.profile, userDataProfilesService.profilesHome.scheme));
		serviceCollection.set(IUserDataProfileService, userDataProfileService);

		// Use FileUserDataProvider for user data to
		// enable atomic read / write operations.
		fileService.registerProvider(Schemas.vscodeUserData, this._register(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.vscodeUserData, userDataProfilesService, uriIdentityService, logService)));

		// Remote Agent
		const remoteSocketFactoryService = new RemoteSocketFactoryService();
		remoteSocketFactoryService.register(RemoteConnectionType.WebSocket, new BrowserSocketFactory(null));
		serviceCollection.set(IRemoteSocketFactoryService, remoteSocketFactoryService);
		const remoteAgentService = this._register(new RemoteAgentService(remoteSocketFactoryService, userDataProfileService, environmentService, productService, remoteAuthorityResolverService, signService, logService));
		serviceCollection.set(IRemoteAgentService, remoteAgentService);

		// Remote Files
		this._register(RemoteFileSystemProviderClient.register(remoteAgentService, fileService, logService));

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.desktop.main.ts` if the service
		//       is desktop only.
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

		// Create services that require resolving in parallel
		const workspace = this.resolveWorkspaceIdentifier(environmentService);
		const [configurationService, storageService] = await Promise.all([
			this.createWorkspaceService(workspace, environmentService, userDataProfileService, userDataProfilesService, fileService, remoteAgentService, uriIdentityService, logService, policyService).then(service => {

				// Workspace
				serviceCollection.set(IWorkspaceContextService, service);

				// Configuration
				serviceCollection.set(IWorkbenchConfigurationService, service);

				return service;
			}),

			this.createStorageService(workspace, environmentService, userDataProfileService, userDataProfilesService, mainProcessService).then(service => {

				// Storage
				serviceCollection.set(IStorageService, service);

				return service;
			}),

			this.createKeyboardLayoutService(mainProcessService).then(service => {

				// KeyboardLayout
				serviceCollection.set(INativeKeyboardLayoutService, service);

				return service;
			})
		]);

		// Workspace Trust Service
		const workspaceTrustEnablementService = new WorkspaceTrustEnablementService(configurationService, environmentService);
		serviceCollection.set(IWorkspaceTrustEnablementService, workspaceTrustEnablementService);

		const workspaceTrustManagementService = new WorkspaceTrustManagementService(configurationService, remoteAuthorityResolverService, storageService, uriIdentityService, environmentService, configurationService, workspaceTrustEnablementService, fileService);
		serviceCollection.set(IWorkspaceTrustManagementService, workspaceTrustManagementService);

		// Update workspace trust so that configuration is updated accordingly
		configurationService.updateWorkspaceTrust(workspaceTrustManagementService.isWorkspaceTrusted());
		this._register(workspaceTrustManagementService.onDidChangeTrust(() => configurationService.updateWorkspaceTrust(workspaceTrustManagementService.isWorkspaceTrusted())));


		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.desktop.main.ts` if the service
		//       is desktop only.
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		return { serviceCollection, logService, storageService, configurationService };
	}

	private resolveWorkspaceIdentifier(environmentService: INativeWorkbenchEnvironmentService): IAnyWorkspaceIdentifier {

		// Return early for when a folder or multi-root is opened
		if (this.configuration.workspace) {
			return this.configuration.workspace;
		}

		// Otherwise, workspace is empty, so we derive an identifier
		return toWorkspaceIdentifier(this.configuration.backupPath, environmentService.isExtensionDevelopment);
	}

	private async createWorkspaceService(
		workspace: IAnyWorkspaceIdentifier,
		environmentService: INativeWorkbenchEnvironmentService,
		userDataProfileService: IUserDataProfileService,
		userDataProfilesService: IUserDataProfilesService,
		fileService: FileService,
		remoteAgentService: IRemoteAgentService,
		uriIdentityService: IUriIdentityService,
		logService: ILogService,
		policyService: IPolicyService
	): Promise<WorkspaceService> {
		const configurationCache = new ConfigurationCache([Schemas.file, Schemas.vscodeUserData] /* Cache all non native resources */, environmentService, fileService);
		const workspaceService = new WorkspaceService({ remoteAuthority: environmentService.remoteAuthority, configurationCache }, environmentService, userDataProfileService, userDataProfilesService, fileService, remoteAgentService, uriIdentityService, logService, policyService);

		try {
			await workspaceService.initialize(workspace);

			return workspaceService;
		} catch (error) {
			onUnexpectedError(error);

			return workspaceService;
		}
	}

	private async createStorageService(workspace: IAnyWorkspaceIdentifier, environmentService: INativeWorkbenchEnvironmentService, userDataProfileService: IUserDataProfileService, userDataProfilesService: IUserDataProfilesService, mainProcessService: IMainProcessService): Promise<NativeWorkbenchStorageService> {
		const storageService = new NativeWorkbenchStorageService(workspace, userDataProfileService, userDataProfilesService, mainProcessService, environmentService);

		try {
			await storageService.initialize();

			return storageService;
		} catch (error) {
			onUnexpectedError(error);

			return storageService;
		}
	}

	private async createKeyboardLayoutService(mainProcessService: IMainProcessService): Promise<NativeKeyboardLayoutService> {
		const keyboardLayoutService = new NativeKeyboardLayoutService(mainProcessService);

		try {
			await keyboardLayoutService.initialize();

			return keyboardLayoutService;
		} catch (error) {
			onUnexpectedError(error);

			return keyboardLayoutService;
		}
	}
}

export interface IDesktopMain {
	main(configuration: INativeWindowConfiguration): Promise<void>;
}

export function main(configuration: INativeWindowConfiguration): Promise<void> {
	// test-workbench_change start
	// 渲染进程核心日志截获：仅当 capturedLog.logSourceEnabled 含 'renderer' 时安装 console hook，
	// 未启用时零开销（不 hook console、不监听 window 事件），避免对启动性能造成影响。
	if (isCapturedLogSourceEnabled({ _serviceBrand: undefined, ...product }, 'renderer')) {
		try {
			// traceEnabled 下沉：把 capturedLog.traceEnabled 传入产生侧（关闭时跳过 trace 计算）
			// logLevelEnabled 下沉：把 capturedLog.logLevelEnabled 传入产生侧（'all' | 级别数组 |
			// undefined，过滤先于 trace 推进，被过滤日志不占 traceIndex、不上报，原生 console 不受影响）
			installRendererLogCapture(isCapturedLogTraceEnabled({ _serviceBrand: undefined, ...product }), product.capturedLog?.logLevelEnabled);
		} catch (error) {
			// 日志截获为增强特性：安装失败时仅记录，不应影响工作台启动
			console.warn('[capturedLog] 安装渲染进程日志截获失败', error);
		}
	}
	// test-workbench_change end

	const workbench = new DesktopMain(configuration);

	return workbench.open();
}

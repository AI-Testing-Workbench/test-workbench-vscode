/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
// test-workbench_change start
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
// test-workbench_change end
import { IOutputChannel, IOutputService, OUTPUT_VIEW_ID, LOG_MIME, OUTPUT_MIME, OutputChannelUpdateMode, IOutputChannelDescriptor, Extensions, IOutputChannelRegistry, ACTIVE_OUTPUT_CHANNEL_CONTEXT, CONTEXT_ACTIVE_FILE_OUTPUT, CONTEXT_ACTIVE_OUTPUT_LEVEL_SETTABLE, CONTEXT_ACTIVE_OUTPUT_LEVEL, CONTEXT_ACTIVE_OUTPUT_LEVEL_IS_DEFAULT, IOutputViewFilters, SHOW_DEBUG_FILTER_CONTEXT, SHOW_ERROR_FILTER_CONTEXT, SHOW_INFO_FILTER_CONTEXT, SHOW_TRACE_FILTER_CONTEXT, SHOW_WARNING_FILTER_CONTEXT, CONTEXT_ACTIVE_LOG_FILE_OUTPUT, IMultiSourceOutputChannelDescriptor, isSingleSourceOutputChannelDescriptor, HIDE_CATEGORY_FILTER_CONTEXT, isMultiSourceOutputChannelDescriptor, ILogEntry } from '../../../services/output/common/output.js';
import { OutputLinkProvider } from './outputLinkProvider.js';
import { ITextModelService, ITextModelContentProvider } from '../../../../editor/common/services/resolverService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILogService, ILoggerService, LogLevel, LogLevelToString } from '../../../../platform/log/common/log.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
// test-workbench_change start
import { AbstractFileOutputChannelModel, DelegatedOutputChannelModel, FileOutputChannelModel, IOutputChannelModel, MultiFileOutputChannelModel } from '../common/outputChannelModel.js';
// test-workbench_change end
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { OutputViewPane } from './outputView.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { localize } from '../../../../nls.js';
import { joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
// test-workbench_change start
import { IProductService, isCapturedLogSourceEnabled, isCapturedExtensionIdEnabled, isCapturedOutputChannelNameEnabled, isCapturedLogTraceEnabled, isCapturedLogLevelEnabled } from '../../../../platform/product/common/productService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { telemetryLogId, TelemetryTrustedValue } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { TraceContextState } from '../../../../base/common/traceContext.js';
// test-workbench_change end
import { toLocalISOString } from '../../../../base/common/date.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IDefaultLogLevelsService } from '../../../services/log/common/defaultLogLevels.js';

const OUTPUT_ACTIVE_CHANNEL_KEY = 'output.activechannel';

class OutputChannel extends Disposable implements IOutputChannel {

	scrollLock: boolean = false;
	readonly model: IOutputChannelModel;
	readonly id: string;
	readonly label: string;
	readonly uri: URI;

	constructor(
		readonly outputChannelDescriptor: IOutputChannelDescriptor,
		private readonly outputLocation: URI,
		private readonly outputDirPromise: Promise<void>,
		@ILanguageService private readonly languageService: ILanguageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		// test-workbench_change start
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IProductService private readonly productService: IProductService,
		@IExtensionService private readonly extensionService: IExtensionService,
		// test-workbench_change end
	) {
		super();
		this.id = outputChannelDescriptor.id;
		this.label = outputChannelDescriptor.label;
		this.uri = URI.from({ scheme: Schemas.outputChannel, path: this.id });
		this.model = this._register(this.createOutputChannelModel(this.uri, outputChannelDescriptor));
		// test-workbench_change start
		// capturedLog 日志截获：扩展/内置输出内容统一经文件轮询增量读取（AbstractFileOutputChannelModel.appendContent），
		// 在此注入回调上报，确保覆盖 appendLine 等全部输出路径（OutputChannel.append 对 File 型 model 不可用）。
		if (this.model instanceof AbstractFileOutputChannelModel || this.model instanceof DelegatedOutputChannelModel) {
			this.model.onAppendedContent = content => this.reportOutputChannelLog(content);
		}
		// test-workbench_change end
	}

	// test-workbench_change start
	private readonly _extensionVersionCache = new Map<string, string | undefined>();
	// 链路追踪状态机（capturedLog 第二阶段）：按 channel 实例独立维护（每个 channel 一条链），
	// 文件轮询读取无业务调用栈，仅按时间窗判定流程边界。
	// 同一 traceId 内 traceIndex 从 1 开始递增编号（同一次处理流程的消息按产生顺序排序）。
	private readonly _traceContext = new TraceContextState();

	private async _getExtensionVersion(extensionId: string | undefined): Promise<string | undefined> {
		if (!extensionId) {
			return undefined;
		}
		if (this._extensionVersionCache.has(extensionId)) {
			return this._extensionVersionCache.get(extensionId);
		}
		let version: string | undefined;
		try {
			const ext = await this.extensionService.getExtension(extensionId);
			version = ext?.version;
		} catch {
			version = undefined;
		}
		this._extensionVersionCache.set(extensionId, version);
		return version;
	}

	private async reportOutputChannelLog(content: string): Promise<void> {
		// Telemetry 日志 channel 的内容本身就是上报动作的副产物（TelemetryLogAppender 会把每条 telemetry
		// 事件写回该 channel）。若对它也上报，上报日志又会写回该 channel，形成"截获->上报->写回->再截获"
		// 的递归循环（本地日志无限膨胀，且每次 publicLog 都会经 OneDataSystemAppender 网络上报）。
		// 故排除该 channel：id 恒为 telemetryLogId，label 视 nls 可能为英文 "Telemetry" 或中文 "遥测"，一并拦截。
		if (this.id === telemetryLogId || this.label === 'Telemetry' || this.label === '遥测') {
			return;
		}
		// 配置开关：product.json 的 capturedLog.logSourceEnabled 不含 'outputChannel' 时不上报；
		// 配置维度：capturedLog.extensionIdEnabled 决定该 extensionId 是否上报，
		// capturedLog.outputChannelNameEnabled 决定该 outputChannelName（this.label）是否上报；
		// 两者为 OR 关系，再与 logSourceEnabled 做 AND：满足任一维度即上报。
		if (isCapturedLogSourceEnabled(this.productService, 'outputChannel') && (isCapturedExtensionIdEnabled(this.productService, this.outputChannelDescriptor.extensionId) || isCapturedOutputChannelNameEnabled(this.productService, this.label))) {
			const extensionVersion = await this._getExtensionVersion(this.outputChannelDescriptor.extensionId);
			// 增量内容来自日志文件的原始字节，末尾可能带行尾换行符（Windows 下为 \r\n）。
			// 该换行符是文件行尾而非日志正文，上报前清理尾部换行（仅尾部，多行内容内部的换行保留），
			// 与其他链路（extensionHost/webview）的 message 格式保持一致。
			const cleanContent = content.replace(/(\r?\n)+$/, '');
			// logLevelEnabled 级别过滤（方案 2，四条链路统一应用）：解析行首级别标记（_parseLogLevel
			// 为纯函数无副作用），过滤判断先于 trace 状态机推进（next）——被过滤日志不占 traceIndex
			// （编号连续）且不上报；日志文件内容本身不受影响（输出通道显示零变化）。
			const logLevel = this._parseLogLevel(cleanContent);
			if (!isCapturedLogLevelEnabled(this.productService, logLevel)) {
				return;
			}
			// 链路追踪（capturedLog 第二阶段）：产生侧（本 channel 实例）赋值。outputChannel 为
			// 文件轮询增量读取、无业务调用栈，仅按时间窗判定流程边界（TRACE_WINDOW_MS（3s）内
			// 连续读取视为同一次处理流程）。
			// 下沉：traceEnabled 关闭时跳过状态机推进与 trace 字段（与改动前行为一致）。
			const traceEnabled = isCapturedLogTraceEnabled(this.productService);
			const traceFields = traceEnabled ? this._traceContext.next(undefined) : undefined;
			this.telemetryService.publicLog('capturedLog', {
				message: new TelemetryTrustedValue(cleanContent),
				logSource: 'outputChannel',
				// log 型通道（Extension Host 等）由 spdlog 写入，行首带 "[level]" 级别标记，
				// 解析首行标记映射为与其他链路一致的缩写 logLevel；纯文本通道无标记时保持 'info'。
				logLevel,
				extensionId: this.outputChannelDescriptor.extensionId,
				...(extensionVersion ? { extensionVersion } : {}),
				outputChannelName: this.label,
				...(traceFields ? { traceId: traceFields.traceId, traceIndex: traceFields.traceIndex } : {})
			});
		}
	}

	// log 型通道（如 Extension Host 日志）由 spdlog 按 "%Y-%m-%d %H:%M:%S.%e [%l] %v" 写入文件，
	// 每行行首带 [info]/[error]/[warning]/[debug]/[trace] 级别标记；普通 appendLine 输出的纯文本无标记。
	// 增量读取内容通常以完整行开头，此处解析首行标记，映射为与其他链路（extensionHost/webview）
	// 一致的缩写 logLevel（warning -> warn），解析失败时返回默认 'info'。
	private _parseLogLevel(content: string): 'info' | 'warn' | 'error' | 'debug' | 'trace' {
		const match = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s\[(info|trace|debug|error|warning)\]/.exec(content)
			|| /^\[(info|trace|debug|error|warning)\]\s/.exec(content);
		if (match) {
			const level = match[1];
			return level === 'warning' ? 'warn' : level as 'info' | 'warn' | 'error' | 'debug' | 'trace';
		}
		return 'info';
	}
	// test-workbench_change end

	private createOutputChannelModel(uri: URI, outputChannelDescriptor: IOutputChannelDescriptor): IOutputChannelModel {
		const language = outputChannelDescriptor.languageId ? this.languageService.createById(outputChannelDescriptor.languageId) : this.languageService.createByMimeType(outputChannelDescriptor.log ? LOG_MIME : OUTPUT_MIME);
		if (isMultiSourceOutputChannelDescriptor(outputChannelDescriptor)) {
			return this.instantiationService.createInstance(MultiFileOutputChannelModel, uri, language, [...outputChannelDescriptor.source]);
		}
		if (isSingleSourceOutputChannelDescriptor(outputChannelDescriptor)) {
			return this.instantiationService.createInstance(FileOutputChannelModel, uri, language, outputChannelDescriptor.source);
		}
		return this.instantiationService.createInstance(DelegatedOutputChannelModel, this.id, uri, language, this.outputLocation, this.outputDirPromise);
	}

	getLogEntries(): ReadonlyArray<ILogEntry> {
		return this.model.getLogEntries();
	}

	append(output: string): void {
		// capturedLog 日志截获已在 model 层（onAppendedContent 回调）统一处理，此处仅正常写入
		this.model.append(output);
	}

	update(mode: OutputChannelUpdateMode, till?: number): void {
		this.model.update(mode, till, true);
	}

	clear(): void {
		this.model.clear();
	}

	replace(value: string): void {
		this.model.replace(value);
	}
}

interface IOutputFilterOptions {
	filterHistory: string[];
	trace: boolean;
	debug: boolean;
	info: boolean;
	warning: boolean;
	error: boolean;
	sources: string;
}

class OutputViewFilters extends Disposable implements IOutputViewFilters {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		options: IOutputFilterOptions,
		private readonly contextKeyService: IContextKeyService
	) {
		super();

		this._trace = SHOW_TRACE_FILTER_CONTEXT.bindTo(this.contextKeyService);
		this._trace.set(options.trace);

		this._debug = SHOW_DEBUG_FILTER_CONTEXT.bindTo(this.contextKeyService);
		this._debug.set(options.debug);

		this._info = SHOW_INFO_FILTER_CONTEXT.bindTo(this.contextKeyService);
		this._info.set(options.info);

		this._warning = SHOW_WARNING_FILTER_CONTEXT.bindTo(this.contextKeyService);
		this._warning.set(options.warning);

		this._error = SHOW_ERROR_FILTER_CONTEXT.bindTo(this.contextKeyService);
		this._error.set(options.error);

		this._categories = HIDE_CATEGORY_FILTER_CONTEXT.bindTo(this.contextKeyService);
		this._categories.set(options.sources);

		this.filterHistory = options.filterHistory;
	}

	filterHistory: string[];

	private _filterText = '';
	private _includePatterns: string[] = [];
	private _excludePatterns: string[] = [];
	get text(): string {
		return this._filterText;
	}
	set text(filterText: string) {
		if (this._filterText !== filterText) {
			this._filterText = filterText;
			const { includePatterns, excludePatterns } = this.parseText(filterText);
			this._includePatterns = includePatterns;
			this._excludePatterns = excludePatterns;
			this._onDidChange.fire();
		}
	}
	private parseText(filterText: string): { includePatterns: string[]; excludePatterns: string[] } {
		const includePatterns: string[] = [];
		const excludePatterns: string[] = [];

		// Parse patterns respecting quoted strings
		const patterns = this.splitByCommaRespectingQuotes(filterText);

		for (const pattern of patterns) {
			const trimmed = pattern.trim();
			if (trimmed.length === 0) {
				continue;
			}

			if (trimmed.startsWith('!')) {
				// Negative filter - remove the ! prefix
				const negativePattern = trimmed.substring(1).trim();
				if (negativePattern.length > 0) {
					excludePatterns.push(negativePattern);
				}
			} else {
				includePatterns.push(trimmed);
			}
		}

		return { includePatterns, excludePatterns };
	}

	get includePatterns(): string[] {
		return this._includePatterns;
	}

	get excludePatterns(): string[] {
		return this._excludePatterns;
	}

	private splitByCommaRespectingQuotes(text: string): string[] {
		const patterns: string[] = [];
		let current = '';
		let inQuotes = false;
		let quoteChar = '';

		for (let i = 0; i < text.length; i++) {
			const char = text[i];

			if (!inQuotes && (char === '"')) {
				// Start of quoted string
				inQuotes = true;
				quoteChar = char;
				current += char;
			} else if (inQuotes && char === quoteChar) {
				// End of quoted string
				inQuotes = false;
				current += char;
			} else if (!inQuotes && char === ',') {
				// Comma outside quotes - split here
				if (current.length > 0) {
					patterns.push(current);
				}
				current = '';
			} else {
				current += char;
			}
		}

		// Add the last pattern
		if (current.length > 0) {
			patterns.push(current);
		}

		return patterns;
	}

	private readonly _trace: IContextKey<boolean>;
	get trace(): boolean {
		return !!this._trace.get();
	}
	set trace(trace: boolean) {
		if (this._trace.get() !== trace) {
			this._trace.set(trace);
			this._onDidChange.fire();
		}
	}

	private readonly _debug: IContextKey<boolean>;
	get debug(): boolean {
		return !!this._debug.get();
	}
	set debug(debug: boolean) {
		if (this._debug.get() !== debug) {
			this._debug.set(debug);
			this._onDidChange.fire();
		}
	}

	private readonly _info: IContextKey<boolean>;
	get info(): boolean {
		return !!this._info.get();
	}
	set info(info: boolean) {
		if (this._info.get() !== info) {
			this._info.set(info);
			this._onDidChange.fire();
		}
	}

	private readonly _warning: IContextKey<boolean>;
	get warning(): boolean {
		return !!this._warning.get();
	}
	set warning(warning: boolean) {
		if (this._warning.get() !== warning) {
			this._warning.set(warning);
			this._onDidChange.fire();
		}
	}

	private readonly _error: IContextKey<boolean>;
	get error(): boolean {
		return !!this._error.get();
	}
	set error(error: boolean) {
		if (this._error.get() !== error) {
			this._error.set(error);
			this._onDidChange.fire();
		}
	}

	private readonly _categories: IContextKey<string>;
	get categories(): string {
		return this._categories.get() || ',';
	}
	set categories(categories: string) {
		this._categories.set(categories);
		this._onDidChange.fire();
	}

	toggleCategory(category: string): void {
		const categories = this.categories;
		if (this.hasCategory(category)) {
			this.categories = categories.replace(`,${category},`, ',');
		} else {
			this.categories = `${categories}${category},`;
		}
	}

	hasCategory(category: string): boolean {
		if (category === ',') {
			return false;
		}
		return this.categories.includes(`,${category},`);
	}
}

export class OutputService extends Disposable implements IOutputService, ITextModelContentProvider {

	declare readonly _serviceBrand: undefined;

	private readonly channels = this._register(new DisposableMap<string, OutputChannel>());
	private activeChannelIdInStorage: string;
	private activeChannel?: OutputChannel;

	private readonly _onActiveOutputChannel = this._register(new Emitter<string>());
	readonly onActiveOutputChannel: Event<string> = this._onActiveOutputChannel.event;

	private readonly activeOutputChannelContext: IContextKey<string>;
	private readonly activeFileOutputChannelContext: IContextKey<boolean>;
	private readonly activeLogOutputChannelContext: IContextKey<boolean>;
	private readonly activeOutputChannelLevelSettableContext: IContextKey<boolean>;
	private readonly activeOutputChannelLevelContext: IContextKey<string>;
	private readonly activeOutputChannelLevelIsDefaultContext: IContextKey<boolean>;

	private readonly outputLocation: URI;

	readonly filters: OutputViewFilters;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILogService private readonly logService: ILogService,
		@ILoggerService private readonly loggerService: ILoggerService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IViewsService private readonly viewsService: IViewsService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IDefaultLogLevelsService private readonly defaultLogLevelsService: IDefaultLogLevelsService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService
	) {
		super();
		this.activeChannelIdInStorage = this.storageService.get(OUTPUT_ACTIVE_CHANNEL_KEY, StorageScope.WORKSPACE, '');
		this.activeOutputChannelContext = ACTIVE_OUTPUT_CHANNEL_CONTEXT.bindTo(contextKeyService);
		this.activeOutputChannelContext.set(this.activeChannelIdInStorage);
		this._register(this.onActiveOutputChannel(channel => this.activeOutputChannelContext.set(channel)));

		this.activeFileOutputChannelContext = CONTEXT_ACTIVE_FILE_OUTPUT.bindTo(contextKeyService);
		this.activeLogOutputChannelContext = CONTEXT_ACTIVE_LOG_FILE_OUTPUT.bindTo(contextKeyService);
		this.activeOutputChannelLevelSettableContext = CONTEXT_ACTIVE_OUTPUT_LEVEL_SETTABLE.bindTo(contextKeyService);
		this.activeOutputChannelLevelContext = CONTEXT_ACTIVE_OUTPUT_LEVEL.bindTo(contextKeyService);
		this.activeOutputChannelLevelIsDefaultContext = CONTEXT_ACTIVE_OUTPUT_LEVEL_IS_DEFAULT.bindTo(contextKeyService);

		this.outputLocation = joinPath(environmentService.windowLogsPath, `output_${toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '')}`);

		// Register as text model content provider for output
		this._register(textModelService.registerTextModelContentProvider(Schemas.outputChannel, this));
		this._register(instantiationService.createInstance(OutputLinkProvider));

		// Create output channels for already registered channels
		const registry = Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels);
		for (const channelIdentifier of registry.getChannels()) {
			this.onDidRegisterChannel(channelIdentifier.id);
		}
		this._register(registry.onDidRegisterChannel(id => this.onDidRegisterChannel(id)));
		this._register(registry.onDidUpdateChannelSources(channel => this.onDidUpdateChannelSources(channel)));
		this._register(registry.onDidRemoveChannel(channel => this.onDidRemoveChannel(channel)));

		// Set active channel to first channel if not set
		if (!this.activeChannel) {
			const channels = this.getChannelDescriptors();
			this.setActiveChannel(channels && channels.length > 0 ? this.getChannel(channels[0].id) : undefined);
		}

		this._register(Event.filter(this.viewsService.onDidChangeViewVisibility, e => e.id === OUTPUT_VIEW_ID && e.visible)(() => {
			if (this.activeChannel) {
				this.viewsService.getActiveViewWithId<OutputViewPane>(OUTPUT_VIEW_ID)?.showChannel(this.activeChannel, true);
			}
		}));

		this._register(this.loggerService.onDidChangeLogLevel(() => {
			this.setLevelContext();
			this.setLevelIsDefaultContext();
		}));
		this._register(this.defaultLogLevelsService.onDidChangeDefaultLogLevels(() => {
			this.setLevelIsDefaultContext();
		}));

		this._register(this.lifecycleService.onDidShutdown(() => this.dispose()));

		this.filters = this._register(new OutputViewFilters({
			filterHistory: [],
			trace: true,
			debug: true,
			info: true,
			warning: true,
			error: true,
			sources: '',
		}, contextKeyService));
	}

	provideTextContent(resource: URI): Promise<ITextModel> | null {
		const channel = <OutputChannel>this.getChannel(resource.path);
		if (channel) {
			return channel.model.loadModel();
		}
		return null;
	}

	async showChannel(id: string, preserveFocus?: boolean): Promise<void> {
		const channel = this.getChannel(id);
		if (this.activeChannel?.id !== channel?.id) {
			this.setActiveChannel(channel);
			this._onActiveOutputChannel.fire(id);
		}
		const outputView = await this.viewsService.openView<OutputViewPane>(OUTPUT_VIEW_ID, !preserveFocus);
		if (outputView && channel) {
			outputView.showChannel(channel, !!preserveFocus);
		}
	}

	getChannel(id: string): OutputChannel | undefined {
		return this.channels.get(id);
	}

	getChannelDescriptor(id: string): IOutputChannelDescriptor | undefined {
		return Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).getChannel(id);
	}

	getChannelDescriptors(): IOutputChannelDescriptor[] {
		return Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).getChannels();
	}

	getActiveChannel(): IOutputChannel | undefined {
		return this.activeChannel;
	}

	canSetLogLevel(channel: IOutputChannelDescriptor): boolean {
		return channel.log && channel.id !== telemetryLogId;
	}

	getLogLevel(channel: IOutputChannelDescriptor): LogLevel | undefined {
		if (!channel.log) {
			return undefined;
		}
		const sources = isSingleSourceOutputChannelDescriptor(channel) ? [channel.source] : isMultiSourceOutputChannelDescriptor(channel) ? channel.source : [];
		if (sources.length === 0) {
			return undefined;
		}

		const logLevel = this.loggerService.getLogLevel();
		return sources.reduce((prev, curr) => Math.min(prev, this.loggerService.getLogLevel(curr.resource) ?? logLevel), LogLevel.Error);
	}

	setLogLevel(channel: IOutputChannelDescriptor, logLevel: LogLevel): void {
		if (!channel.log) {
			return;
		}
		const sources = isSingleSourceOutputChannelDescriptor(channel) ? [channel.source] : isMultiSourceOutputChannelDescriptor(channel) ? channel.source : [];
		if (sources.length === 0) {
			return;
		}
		for (const source of sources) {
			this.loggerService.setLogLevel(source.resource, logLevel);
		}
	}

	registerCompoundLogChannel(descriptors: IOutputChannelDescriptor[]): string {
		const outputChannelRegistry = Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels);
		descriptors.sort((a, b) => a.label.localeCompare(b.label));
		const id = descriptors.map(r => r.id.toLowerCase()).join('-');
		if (!outputChannelRegistry.getChannel(id)) {
			outputChannelRegistry.registerChannel({
				id,
				label: descriptors.map(r => r.label).join(', '),
				log: descriptors.some(r => r.log),
				user: true,
				source: descriptors.map(descriptor => {
					if (isSingleSourceOutputChannelDescriptor(descriptor)) {
						return [{ resource: descriptor.source.resource, name: descriptor.source.name ?? descriptor.label }];
					}
					if (isMultiSourceOutputChannelDescriptor(descriptor)) {
						return descriptor.source;
					}
					const channel = this.getChannel(descriptor.id);
					if (channel) {
						return channel.model.source;
					}
					return [];
				}).flat(),
			});
		}
		return id;
	}

	async saveOutputAs(outputPath?: URI, ...channels: IOutputChannelDescriptor[]): Promise<void> {
		let channel: IOutputChannel | undefined;
		if (channels.length > 1) {
			const compoundChannelId = this.registerCompoundLogChannel(channels);
			channel = this.getChannel(compoundChannelId);
		} else {
			channel = this.getChannel(channels[0].id);
		}

		if (!channel) {
			return;
		}

		try {
			let uri: URI | undefined = outputPath;
			if (!uri) {
				const name = channels.length > 1 ? 'output' : channels[0].label;
				uri = await this.fileDialogService.showSaveDialog({
					title: localize('saveLog.dialogTitle', "Save Output As"),
					availableFileSystems: [Schemas.file],
					defaultUri: joinPath(await this.fileDialogService.defaultFilePath(), `${name}.log`),
					filters: [{
						name,
						extensions: ['log']
					}]
				});
			}

			if (!uri) {
				return;
			}

			const modelRef = await this.textModelService.createModelReference(channel.uri);
			try {
				await this.fileService.writeFile(uri, VSBuffer.fromString(modelRef.object.textEditorModel.getValue()));
			} finally {
				modelRef.dispose();
			}
			return;
		}
		finally {
			if (channels.length > 1) {
				Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).removeChannel(channel.id);
			}
		}
	}

	private async onDidRegisterChannel(channelId: string): Promise<void> {
		const channel = this.createChannel(channelId);
		this.channels.set(channelId, channel);
		if (!this.activeChannel || this.activeChannelIdInStorage === channelId) {
			this.setActiveChannel(channel);
			this._onActiveOutputChannel.fire(channelId);
			const outputView = this.viewsService.getActiveViewWithId<OutputViewPane>(OUTPUT_VIEW_ID);
			outputView?.showChannel(channel, true);
		}
	}

	private onDidUpdateChannelSources(channel: IMultiSourceOutputChannelDescriptor): void {
		const outputChannel = this.channels.get(channel.id);
		if (outputChannel) {
			outputChannel.model.updateChannelSources(channel.source);
		}
	}

	private onDidRemoveChannel(channel: IOutputChannelDescriptor): void {
		if (this.activeChannel?.id === channel.id) {
			const channels = this.getChannelDescriptors();
			if (channels[0]) {
				this.showChannel(channels[0].id);
			}
		}
		this.channels.deleteAndDispose(channel.id);
	}

	private createChannel(id: string): OutputChannel {
		const channel = this.instantiateChannel(id);
		this._register(Event.once(channel.model.onDispose)(() => {
			if (this.activeChannel === channel) {
				const channels = this.getChannelDescriptors();
				const channel = channels.length ? this.getChannel(channels[0].id) : undefined;
				if (channel && this.viewsService.isViewVisible(OUTPUT_VIEW_ID)) {
					this.showChannel(channel.id);
				} else {
					this.setActiveChannel(undefined);
				}
			}
			Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).removeChannel(id);
		}));

		return channel;
	}

	private outputFolderCreationPromise: Promise<void> | null = null;
	private instantiateChannel(id: string): OutputChannel {
		const channelData = Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).getChannel(id);
		if (!channelData) {
			this.logService.error(`Channel '${id}' is not registered yet`);
			throw new Error(`Channel '${id}' is not registered yet`);
		}
		if (!this.outputFolderCreationPromise) {
			this.outputFolderCreationPromise = this.fileService.createFolder(this.outputLocation).then(() => undefined);
		}
		return this.instantiationService.createInstance(OutputChannel, channelData, this.outputLocation, this.outputFolderCreationPromise);
	}

	private setLevelContext(): void {
		const descriptor = this.activeChannel?.outputChannelDescriptor;
		const channelLogLevel = descriptor ? this.getLogLevel(descriptor) : undefined;
		this.activeOutputChannelLevelContext.set(channelLogLevel !== undefined ? LogLevelToString(channelLogLevel) : '');
	}

	private async setLevelIsDefaultContext(): Promise<void> {
		const descriptor = this.activeChannel?.outputChannelDescriptor;
		const channelLogLevel = descriptor ? this.getLogLevel(descriptor) : undefined;
		if (channelLogLevel !== undefined) {
			const channelDefaultLogLevel = this.defaultLogLevelsService.getDefaultLogLevel(descriptor?.extensionId);
			this.activeOutputChannelLevelIsDefaultContext.set(channelDefaultLogLevel === channelLogLevel);
		} else {
			this.activeOutputChannelLevelIsDefaultContext.set(false);
		}
	}

	private setActiveChannel(channel: OutputChannel | undefined): void {
		this.activeChannel = channel;
		const descriptor = channel?.outputChannelDescriptor;
		this.activeFileOutputChannelContext.set(!!descriptor && isSingleSourceOutputChannelDescriptor(descriptor));
		this.activeLogOutputChannelContext.set(!!descriptor?.log);
		this.activeOutputChannelLevelSettableContext.set(descriptor !== undefined && this.canSetLogLevel(descriptor));
		this.setLevelIsDefaultContext();
		this.setLevelContext();

		if (this.activeChannel) {
			this.storageService.store(OUTPUT_ACTIVE_CHANNEL_KEY, this.activeChannel.id, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(OUTPUT_ACTIVE_CHANNEL_KEY, StorageScope.WORKSPACE);
		}
	}
}

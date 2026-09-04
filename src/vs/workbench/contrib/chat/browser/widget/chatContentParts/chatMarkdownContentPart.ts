/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { allowedMarkdownHtmlAttributes, MarkdownRendererMarkedOptions, type MarkdownRenderOptions } from '../../../../../../base/browser/markdownRenderer.js';
import { status } from '../../../../../../base/browser/ui/aria/aria.js';
import { DomScrollableElement } from '../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { wrapTablesWithScrollable } from './chatMarkdownTableScrolling.js';
import { coalesce } from '../../../../../../base/common/arrays.js';
import { findLast } from '../../../../../../base/common/arraysFind.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { isCancellationError } from '../../../../../../base/common/errors.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Lazy } from '../../../../../../base/common/lazy.js';
import { Disposable, DisposableStore, dispose, IDisposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { autorun, autorunSelfDisposable, derived } from '../../../../../../base/common/observable.js';
import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { isLocation, type SymbolTag } from '../../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { EditDeltaInfo } from '../../../../../../editor/common/textModelEditSource.js';
import { localize } from '../../../../../../nls.js';
import { getFlatContextMenuActions } from '../../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IMenuService, MenuId } from '../../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IOpenEditorOptions } from '../../../../../../platform/editor/browser/editor.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../../platform/label/common/label.js';
// test-workbench_change start
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
// test-workbench_change end
import { IMarkdownRenderer } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IEditorService, SIDE_GROUP } from '../../../../../services/editor/common/editorService.js';
import { AccessibilityWorkbenchSettingId } from '../../../../accessibility/browser/accessibilityConfiguration.js';
import { IAiEditTelemetryService } from '../../../../editTelemetry/browser/telemetry/aiEditTelemetry/aiEditTelemetryService.js';
import { MarkedKatexSupport } from '../../../../markdown/browser/markedKatexSupport.js';
import { extractCodeblockUrisFromText, extractVulnerabilitiesFromText } from '../../../common/widget/annotations.js';
import { IEditSessionDiffStats, IEditSessionEntryDiff } from '../../../common/editing/chatEditingService.js';
import { IChatProgressRenderableResponseContent } from '../../../common/model/chatModel.js';
import { IChatContentInlineReference, IChatMarkdownContent, IChatService, IChatUndoStop } from '../../../common/chatService/chatService.js';
import { IChatSessionsService } from '../../../common/chatSessionsService.js';
import { isRequestVM, isResponseVM } from '../../../common/model/chatViewModel.js';
import { ChatConfiguration } from '../../../common/constants.js';
import { IChatCodeBlockInfo } from '../../chat.js';
import { IChatOutputRendererService, type RenderedOutputPart } from '../../chatOutputItemRenderer.js';
import { allowedChatMarkdownHtmlTags } from '../chatContentMarkdownRenderer.js';
import { IMarkdownDiffBlockData, MarkdownDiffBlockPart, parseUnifiedDiff } from './chatDiffBlockPart.js';
import { ChatEditingActionContext } from '../../chatEditing/chatEditingActions.js';
import { ChatMarkdownDecorationsRenderer } from './chatMarkdownDecorationsRenderer.js';
import { CodeBlockPart, ICodeBlockData, ICodeBlockRenderOptions } from './codeBlockPart.js';
import './media/chatCodeBlockPill.css';
import { IDisposableReference } from './chatCollections.js';
import { EditorPool } from './chatContentCodePools.js';
import { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';
// test-workbench_change start
import { IChatMarkdownAnchorService } from './chatMarkdownAnchorService.js';
import { renderFileWidgets } from './chatInlineAnchorWidget.js';
// test-workbench_change end
import { ChatEditPillElement, isResourceContentEmpty } from './chatEditPillElement.js';
import { ChatExtensionsContentPart } from './chatExtensionsContentPart.js';
import { ChatProgressSubPart } from './chatProgressContentPart.js';
import { IncrementalDOMMorpher } from './chatIncrementalRendering/chatIncrementalRendering.js';
import { IChatOutputPartStateCache, IOutputPartState } from './chatOutputPartStateCache.js';
import './media/chatMarkdownPart.css';

const $ = dom.$;

// ── 正文文件路径 linkify ─────────────────────────────────────────────────────

// ponytail: katex 加载失败(上游 Lazy 已缓存加载本身)只在首次记日志,
// 避免流式期间每次重渲染都刷一条 // test-workbench_change
let _katexLoadErrorLogged = false;

// ponytail: 模块级 stat 缓存 + 在途去重:part 实例在流式重渲染间会重建,
// 实例级缓存会触发重复 stat 与链接闪烁;文件存在性在会话内视为稳定 // test-workbench_change
const _fileRefStatCache = new Map<string, Promise<boolean>>();

function statFileRef(fileService: IFileService, target: URI): Promise<boolean> {
	const key = target.toString();
	let p = _fileRefStatCache.get(key);
	if (!p) {
		p = fileService.stat(target).then(() => true, () => false);
		_fileRefStatCache.set(key, p);
	}
	return p;
}

/**
 * 把 markdown 普通文本中的文件路径(绝对路径 / 带目录的相对路径 / 裸文件名)
 * 替换为 toLink 返回的链接文本,使正文里的文件引用可点击。
 * fenced 代码块与行内 code 不处理;toLink 返回 undefined 的候选保持原样。 // test-workbench_change
 */
export function linkifyFileReferences(markdown: string, toLink: (candidate: string) => string | undefined): string {
	if (!markdown) { return markdown; }
	const lines = markdown.split('\n');
	const out: string[] = [];
	let inFence = false;
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		if (inFence) { out.push(line); continue; }
		// 行内 code span 保护(split 捕获组:奇数下标为 code)
		out.push(line.split(/(`[^`\n]+`)/g).map((seg, i) => i % 2 === 1 ? seg : linkifyTextSegment(seg, toLink)).join(''));
	}
	return out.join('\n');
}

// 候选:Windows 绝对路径 / posix 绝对路径(带扩展名) / 带目录的相对路径 / 裸文件名(带扩展名)。
// 前置边界排除 URL(scheme://、//host)与更长 token 的尾部(版本号 v1.2 等由存在性检查兜底)。
const FILE_REF_RE = /(?<![\w.:\/\\-])([A-Za-z]:[\\/][^\s`"')\]<>|,;]+|(?:(?:\/[A-Za-z0-9._@-]+)+\.[A-Za-z0-9]{1,8}|(?:[A-Za-z0-9._@-]+\/)+[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}))/g;

function linkifyTextSegment(text: string, toLink: (candidate: string) => string | undefined): string {
	return text.replace(FILE_REF_RE, (match) => {
		const candidate = match.replace(/[.,;:!?]+$/, ''); // 去掉句尾标点
		const link = toLink(candidate);
		if (!link) { return match; }
		return candidate.length < match.length ? link + match.slice(candidate.length) : link;
	});
}

export interface IChatMarkdownContentPartOptions {
	readonly codeBlockRenderOptions?: ICodeBlockRenderOptions;
	readonly allowInlineDiffs?: boolean;
	readonly horizontalPadding?: number;
	readonly accessibilityOptions?: {
		/**
		 * Message to announce to screen readers as a status update if VerboseChatProgressUpdates is enabled.
		 * Will also be used as the aria-label for the container.
		 * */
		statusMessage?: string;
	};
}

interface IMarkdownPartCodeBlockInfo extends IChatCodeBlockInfo {
	isStreamingEdit: boolean;
}

export class ChatMarkdownContentPart extends Disposable implements IChatContentPart {

	private static ID_POOL = 0;

	readonly codeblocksPartId = String(++ChatMarkdownContentPart.ID_POOL);
	readonly domNode: HTMLElement;

	// This Event exists for one specific scenario and the pattern shouldn't be copied without a good reason
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _onDidChangeDiff = this._register(new Emitter<IEditSessionDiffStats>());
	/**
	 * Fires when any edit pill (CollapsedCodeBlock) in this markdown part updates its diff.
	 * The aggregated stats reflect the total added/removed across all edit pills.
	 */
	readonly onDidChangeDiff: Event<IEditSessionDiffStats> = this._onDidChangeDiff.event;

	private readonly allRefs: IDisposableReference<CodeBlockPart | ChatOutputCodeBlockPart | CollapsedCodeBlock | MarkdownDiffBlockPart>[] = [];

	private readonly _codeblocks: IMarkdownPartCodeBlockInfo[] = [];
	public get codeblocks(): IChatCodeBlockInfo[] {
		return this._codeblocks;
	}

	private readonly mathLayoutParticipants = new Set<() => void>();

	/** Incremental rendering morpher — only created when the experiment is enabled. */
	private _incrementalMorpher: IncrementalDOMMorpher | undefined;

	// test-workbench_change start
	// 重渲染引用(构造器内 doRenderMarkdown 定义后赋值):相对路径存在性检查确认后补渲染
	private _rerenderMarkdown: (() => void) | undefined;
	// 正文文件路径存在性检查缓存:候选 → 已确认 / 已排除 / 检查中
	private readonly _linkifyCache = new Map<string, boolean | 'pending'>();
	private _linkifyRerenderScheduled = false;
	// test-workbench_change end

	constructor(
		private markdown: IChatMarkdownContent,
		context: IChatContentPartRenderContext,
		private readonly editorPool: EditorPool,
		fillInIncompleteTokens = false,
		codeBlockStartIndex = 0,
		renderer: IMarkdownRenderer,
		markdownRenderOptions: MarkdownRenderOptions | undefined,
		currentWidth: number,
		private readonly rendererOptions: IChatMarkdownContentPartOptions,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAiEditTelemetryService private readonly aiEditTelemetryService: IAiEditTelemetryService,
		@IChatOutputRendererService private readonly chatOutputRendererService: IChatOutputRendererService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		// test-workbench_change: 把正文里 provider 发来的 file:// 链接渲染成可点击文件 widget
		@IChatMarkdownAnchorService private readonly chatMarkdownAnchorService: IChatMarkdownAnchorService,
		// test-workbench_change: 正文文件路径 linkify(工作区解析 + 存在性检查)
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		const element = context.element;
		const inUndoStop = (findLast(context.content, e => e.kind === 'undoStop', context.contentIndex) as IChatUndoStop | undefined)?.id;

		// Need to track the index of the codeblock within the response so it can have a unique ID,
		// and within this part to find it within the codeblocks array
		let globalCodeBlockIndexStart = codeBlockStartIndex;

		this.domNode = $('div.chat-markdown-part');

		if (this.rendererOptions.accessibilityOptions?.statusMessage) {
			this.domNode.ariaLabel = this.rendererOptions.accessibilityOptions.statusMessage;
			if (configurationService.getValue<boolean>(AccessibilityWorkbenchSettingId.VerboseChatProgressUpdates)) {
				status(this.rendererOptions.accessibilityOptions.statusMessage);
			}
		}

		const enableMath = configurationService.getValue<boolean>(ChatConfiguration.EnableMath);

		// Initialize incremental rendering morpher when the experiment is enabled.
		// Only create for actively streaming responses (!element.isComplete),
		// not for completed responses loaded from history — even if
		// fillInIncompleteTokens is true (e.g. canceled or incomplete responses).
		const incrementalRenderingEnabled = configurationService.getValue<boolean>(ChatConfiguration.IncrementalRendering);
		if (incrementalRenderingEnabled && isResponseVM(element) && fillInIncompleteTokens && !element.isComplete) {
			this._incrementalMorpher = this._register(instantiationService.createInstance(IncrementalDOMMorpher, this.domNode));
			this._incrementalMorpher.setRenderCallback((newMd) => {
				// Temporarily swap this.markdown to the buffered content
				// for doRenderMarkdown(), then restore it. The morpher may
				// render a subset of the full markdown (word/paragraph
				// buffering), but this.markdown must always reflect the
				// latest full content from tryIncrementalUpdate so that
				// hasSameContent() returns true and avoids unnecessary
				// re-diffs on the next renderElement call.
				const savedMarkdown = this.markdown;
				const content = new MarkdownString(newMd, this.markdown.content);
				content.baseUri = URI.revive(this.markdown.content.baseUri);
				content.uris = this.markdown.content.uris;
				this.markdown = { ...this.markdown, content };
				doRenderMarkdown();
				this.markdown = savedMarkdown;
				// Notify the list that our height changed so it can
				// update scroll position. The morpher renders via rAF,
				// outside the normal renderElement flow, so the list
				// won't pick this up without an explicit notification.
				this._onDidChangeHeight.fire();
			});
		}

		const renderStore = this._register(new MutableDisposable<DisposableStore>());

		const doRenderMarkdown = () => {
			if (this._store.isDisposed) {
				return;
			}

			const previousRenderStore = renderStore.clearAndLeak();
			const reusableOutputCodeBlockRefs = new Map<string, IDisposableReference<ChatOutputCodeBlockPart>>();
			for (const ref of this.allRefs) {
				if (ref.object instanceof ChatOutputCodeBlockPart) {
					const outputRef = ref as IDisposableReference<ChatOutputCodeBlockPart>;
					previousRenderStore?.deleteAndLeak(outputRef);
					reusableOutputCodeBlockRefs.set(outputRef.object.reuseKey, outputRef);
				}
			}
			previousRenderStore?.dispose();

			// Reset state for re-render
			const store = new DisposableStore();
			renderStore.value = store;
			dom.clearNode(this.domNode);
			this.allRefs.length = 0;
			this._codeblocks.length = 0;
			this.mathLayoutParticipants.clear();
			globalCodeBlockIndexStart = codeBlockStartIndex;

			// TODO: Move katex support into chatMarkdownRenderer
			const markedExtensions = enableMath
				? coalesce([MarkedKatexSupport.getExtension(dom.getWindow(context.container), {
					throwOnError: false
				})])
				: [];

			// Enables github-flavored-markdown + line breaks with single newlines
			// (which matches typical expectations but isn't "proper" in markdown)
			const markedOpts: MarkdownRendererMarkedOptions = {
				gfm: true,
				breaks: true,
			};

			const configuredUriTransformer = markdownRenderOptions?.transformUri;
			const transformUri = isResponseVM(element)
				? (href: string, kind: 'link' | 'image') => this.chatSessionsService.resolveChatResponseUri(element.sessionResource, configuredUriTransformer?.(href, kind) ?? href, kind)
				: configuredUriTransformer;
			// 正文文件路径 linkify(代码块除外)。只在 part 完成后应用:流式期间
			// 候选集随打字不断变化 + 存在性检查异步,边打字边链接会抖动;
			// 完成后一次性转链接(相对路径存在性确认后再补渲染一次) // test-workbench_change
			const applyLinks = !isResponseVM(element) || element.isComplete;
			const linkifiedValue = linkifyFileReferences(this.markdown.content.value, candidate => this._linkifyCandidate(candidate, applyLinks));
			const mdToRender = linkifiedValue === this.markdown.content.value
				? this.markdown.content
				: (() => {
					const content = new MarkdownString(linkifiedValue, this.markdown.content);
					content.baseUri = URI.revive(this.markdown.content.baseUri);
					content.uris = this.markdown.content.uris;
					return content;
				})();
			const result = store.add(renderer.render(mdToRender, {
				sanitizerConfig: MarkedKatexSupport.getSanitizerOptions({
					allowedTags: allowedChatMarkdownHtmlTags,
					allowedAttributes: allowedMarkdownHtmlAttributes,
				}),
				fillInIncompleteTokens,
				codeBlockRendererSync: (languageId, text, raw) => {
					const isCodeBlockComplete = !isResponseVM(context.element) || context.element.isComplete || !raw || codeblockHasClosingBackticks(raw);
					const hasChatOutputRenderer = !!languageId
						&& this.chatOutputRendererService.hasCodeBlockRenderer(languageId);
					if ((!text || (text.startsWith('<vscode_codeblock_uri') && !text.includes('\n')))
						&& !isCodeBlockComplete
						&& !hasChatOutputRenderer) {
						const hideEmptyCodeblock = $('div');
						hideEmptyCodeblock.style.display = 'none';
						return hideEmptyCodeblock;
					}
					if (languageId === 'diff' && raw && this.rendererOptions.allowInlineDiffs) {
						const match = raw.match(/^```diff:(\w+)/);
						if (match && isResponseVM(context.element)) {
							const actualLanguageId = match[1];
							const codeBlockUri = extractCodeblockUrisFromText(text);
							const { before, after } = parseUnifiedDiff(codeBlockUri?.textWithoutResult ?? text);
							const diffData: IMarkdownDiffBlockData = {
								element: context.element,
								codeBlockIndex: globalCodeBlockIndexStart++,
								languageId: actualLanguageId,
								beforeContent: before,
								afterContent: after,
								codeBlockResource: codeBlockUri?.uri,
								isReadOnly: true,
								horizontalPadding: this.rendererOptions.horizontalPadding,
							};
							const diffPart = this.instantiationService.createInstance(MarkdownDiffBlockPart, diffData, context.diffEditorPool, context.currentWidth.get());
							const ref: IDisposableReference<MarkdownDiffBlockPart> = {
								object: diffPart,
								isStale: () => false,
								dispose: () => diffPart.dispose()
							};
							this.allRefs.push(ref);
							store.add(ref);
							return diffPart.element;
						}
					}
					if (languageId === 'vscode-extensions') {
						const chatExtensions = store.add(instantiationService.createInstance(ChatExtensionsContentPart, { kind: 'extensions', extensions: text.split(',') }));
						return chatExtensions.domNode;
					}
					const globalIndex = globalCodeBlockIndexStart++;
					let codeBlockText = text;
					const extractedVulns = extractVulnerabilitiesFromText(text);
					codeBlockText = fixCodeText(extractedVulns.newText, languageId);
					const vulns = extractedVulns.vulnerabilities;

					let codemapperUri: URI | undefined;
					let isEdit: boolean | undefined;
					const codeblockUri = extractCodeblockUrisFromText(codeBlockText);
					if (codeblockUri) {
						codemapperUri = codeblockUri.uri;
						isEdit = codeblockUri.isEdit;
						codeBlockText = codeblockUri.textWithoutResult;
					}

					const hideToolbar = isResponseVM(element) && element.errorDetails?.responseIsFiltered;
					const renderOptions = {
						...this.rendererOptions.codeBlockRenderOptions,
					};
					if (hideToolbar !== undefined) {
						renderOptions.hideToolbar = hideToolbar;
					}
					const codeBlockInfo: ICodeBlockData = { languageId, text: codeBlockText, codeBlockIndex: globalIndex, element, parentContextKeyService: contextKeyService, vulns, codemapperUri, renderOptions, chatSessionResource: element.sessionResource };
					const baseCodeBlockInfo = {
						ownerMarkdownPartId: this.codeblocksPartId,
						codeBlockIndex: globalIndex,
						elementId: element.id,
						chatSessionResource: element.sessionResource,
						languageId,
						editDeltaInfo: EditDeltaInfo.fromText(text),
					};

					if (element.isCompleteAddedRequest || !codemapperUri || !isEdit) {
						if (hasChatOutputRenderer) {
							const ref = this.renderChatOutputCodeBlock(languageId, codeBlockText, globalIndex, context, isCodeBlockComplete, reusableOutputCodeBlockRefs);
							this._codeblocks.push({
								...baseCodeBlockInfo,
								codemapperUri: codeBlockInfo.codemapperUri,
								isStreamingEdit: false,
								get uri() {
									return undefined;
								},
								focus() {
									ref.object.focus();
								},
							});
							store.add(ref);
							return ref.object.element;
						}

						const ref = this.renderCodeBlock(codeBlockInfo, currentWidth);
						this._codeblocks.push({
							...baseCodeBlockInfo,
							codemapperUri: codeBlockInfo.codemapperUri,
							isStreamingEdit: false,
							get uri() {
								return ref.object.uri;
							},
							focus() {
								ref.object.focus();
							},
						});
						store.add(ref);
						return ref.object.element;
					}

					const requestId = isRequestVM(element) ? element.id : element.requestId;
					const ref = this.renderCodeBlockPill(element.sessionResource, requestId, inUndoStop, codemapperUri);
					this._codeblocks.push({
						...baseCodeBlockInfo,
						codemapperUri,
						isStreamingEdit: !isCodeBlockComplete,
						get uri() {
							return undefined;
						},
						focus() {
							return ref.object.element.focus();
						},
					});
					store.add(ref);
					return ref.object.element;
				},
				markedOptions: markedOpts,
				markedExtensions,
				...markdownRenderOptions,
				transformUri,
			}, this.domNode));

			// Ideally this would happen earlier, but we need to parse the markdown.
			if (isResponseVM(element) && !element.model.codeBlockInfos && element.model.isComplete) {
				element.model.initializeCodeBlockInfos(this._codeblocks.map(info => {
					return {
						suggestionId: this.aiEditTelemetryService.createSuggestionId({
							presentation: 'codeBlock',
							feature: 'sideBarChat',
							editDeltaInfo: info.editDeltaInfo,
							languageId: info.languageId,
							modeId: element.model.request?.modeInfo?.telemetryModeId,
							modelId: element.model.request?.modelId,
							applyCodeBlockSuggestionId: undefined,
							source: undefined,
							sourceRequestId: undefined,
						})
					};
				}));
			}

		const markdownDecorationsRenderer = instantiationService.createInstance(ChatMarkdownDecorationsRenderer);
		store.add(markdownDecorationsRenderer.walkTreeAndAnnotateReferenceLinks(this.markdown, result.element));

		// 正文 markdown 中的文件链接(任意 provider 发来的 [x](file://…),含 vscodeLinkType
		// 标签或空链接文本)渲染为可点击文件 widget —— 与工具确认/折叠标题等 part 同一条
		// 管线;store 在下次重渲染时统一 dispose(widget 从 anchorService 注销)。 // test-workbench_change
		renderFileWidgets(result.element, this.instantiationService, this.chatMarkdownAnchorService, store);

			const layoutParticipants = new Lazy(() => {
				const observer = store.add(new dom.DisposableResizeObserver('ChatMarkdownContentPart.mathLayout', () => this.mathLayoutParticipants.forEach(layout => layout())));
				store.add(observer.observe(this.domNode));
				return this.mathLayoutParticipants;
			});

			// Make katex blocks horizontally scrollable
			// eslint-disable-next-line no-restricted-syntax
			for (const katexBlock of this.domNode.querySelectorAll('.katex-display')) {
				if (!dom.isHTMLElement(katexBlock)) {
					continue;
				}

				const scrollable = new DomScrollableElement(katexBlock.cloneNode(true) as HTMLElement, {
					vertical: ScrollbarVisibility.Hidden,
					horizontal: ScrollbarVisibility.Auto,
				});
				store.add(scrollable);
				katexBlock.replaceWith(scrollable.getDomNode());

				layoutParticipants.value.add(() => { scrollable.scanDomNode(); });
				scrollable.scanDomNode();
			}

			store.add(wrapTablesWithScrollable(this.domNode, layoutParticipants));
			dispose(reusableOutputCodeBlockRefs.values());
		};

		this._rerenderMarkdown = doRenderMarkdown; // test-workbench_change

		// Always render immediately
		doRenderMarkdown();

		// Seed the morpher *after* the initial render so it captures
		// the correct markdown baseline. Pass `animateInitial: true`
		// so the initial DOM children receive the entrance animation —
		// this is important when a markdown part first appears (e.g.
		// after thinking content) and already contains visible content.
		this._incrementalMorpher?.seed(markdown.content.value, /* animateInitial */ true);

		if (enableMath && !MarkedKatexSupport.getExtension(dom.getWindow(context.container))) {
			// KaTeX not yet loaded - render and re-render after loading
			MarkedKatexSupport.loadExtension(dom.getWindow(context.container))
				.then(() => {
					doRenderMarkdown();
				})
				.catch(e => {
					// test-workbench_change: 加载失败只记一次(上游 Lazy 已缓存,这里只是避免每次重渲染刷日志)
					if (!_katexLoadErrorLogged) {
						_katexLoadErrorLogged = true;
						console.error('Failed to load MarkedKatexSupport extension:', e);
					}
				});
		}
	}

	override dispose(): void {
		super.dispose();

		dispose(this.allRefs);
		this.allRefs.length = 0;
	}

	private renderCodeBlockPill(sessionResource: URI, requestId: string, inUndoStop: string | undefined, codemapperUri: URI): IDisposableReference<CollapsedCodeBlock> {
		const codeBlock = this.instantiationService.createInstance(CollapsedCodeBlock, sessionResource, requestId, inUndoStop);
		const diffListenerStore = new DisposableStore();
		const ref: IDisposableReference<CollapsedCodeBlock> = {
			object: codeBlock,
			isStale: () => false,
			dispose: () => {
				codeBlock.dispose();
				diffListenerStore.dispose();
			}
		};

		// Push to allRefs and register the diff listener before calling render(),
		// since diff observables may fire synchronously when the editing session
		// already has finalized diff data (e.g. on session restore).
		this.allRefs.push(ref);
		diffListenerStore.add(codeBlock.onDidChangeDiff(() => this.fireAggregatedDiff()));
		codeBlock.render(codemapperUri);
		return ref;
	}

	private renderChatOutputCodeBlock(
		identifier: string,
		text: string,
		codeBlockIndex: number,
		context: IChatContentPartRenderContext,
		isComplete: boolean,
		reusableOutputCodeBlockRefs: Map<string, IDisposableReference<ChatOutputCodeBlockPart>>,
	): IDisposableReference<ChatOutputCodeBlockPart> {
		const reuseKey = ChatOutputCodeBlockPart.reuseKey(context.element.id, codeBlockIndex, identifier);
		const reusableRef = reusableOutputCodeBlockRefs.get(reuseKey);
		if (reusableRef?.object.hasSameContent(identifier, text, isComplete)) {
			reusableOutputCodeBlockRefs.delete(reuseKey);
			this.allRefs.push(reusableRef);
			return reusableRef;
		}

		const codeBlock = this.instantiationService.createInstance(
			ChatOutputCodeBlockPart,
			identifier,
			text,
			codeBlockIndex,
			context,
			isComplete,
			() => this._onDidChangeHeight.fire()
		);
		const ref: IDisposableReference<ChatOutputCodeBlockPart> = {
			object: codeBlock,
			isStale: () => false,
			dispose: () => codeBlock.dispose()
		};
		this.allRefs.push(ref);
		return ref;
	}

	private fireAggregatedDiff(): void {
		let totalAdded = 0;
		let totalRemoved = 0;
		for (const ref of this.allRefs) {
			if (ref.object instanceof CollapsedCodeBlock && ref.object.diff) {
				totalAdded += ref.object.diff.added;
				totalRemoved += ref.object.diff.removed;
			}
		}
		this._onDidChangeDiff.fire({ added: totalAdded, removed: totalRemoved });
	}

	private renderCodeBlock(data: ICodeBlockData, currentWidth: number): IDisposableReference<CodeBlockPart> {
		const key = CodeBlockPart.poolKey(data.element.id, data.codeBlockIndex);
		const ref = this.editorPool.get(key);
		this.allRefs.push(ref);
		ref.object.render(data, currentWidth);

		// There is a scenario where request code block content changes without a ResizeObserver callback.
		// Work around it with this targeted onDidHeightChange. But this pattern generally shouldn't be necessary and
		// shouldn't be copied elsewhere.
		if (!this._store.isDisposed && isRequestVM(data.element)) {
			this._onDidChangeHeight.fire();
		}

		return ref;
	}

	hasSameContent(other: IChatProgressRenderableResponseContent): boolean {
		if (other.kind !== 'markdownContent') {
			return false;
		}

		if (other.content.value === this.markdown.content.value && equalsInlineReferences(other.inlineReferences, this.markdown.inlineReferences)) {
			return true;
		}

		// If we are streaming in code shown in an edit pill, do not re-render the entire content as long as it's coming in
		const lastCodeblock = this._codeblocks.at(-1);
		if (lastCodeblock && lastCodeblock.codemapperUri !== undefined && lastCodeblock.isStreamingEdit) {
			return other.content.value.lastIndexOf('```') === this.markdown.content.value.lastIndexOf('```');
		}

		return false;
	}

	/**
	 * Attempts an incremental DOM update for smooth streaming instead of
	 * tearing down and rebuilding the entire markdown part.
	 *
	 * The morpher checks that the new content is a pure append, then
	 * schedules a rAF-batched re-render through the full markdown
	 * pipeline. Code blocks, tables, and all markdown features are
	 * rendered correctly because the update goes through the standard
	 * `doRenderMarkdown()` path.
	 *
	 * @param newMarkdown The new (appended) markdown content.
	 * @returns `true` if the incremental update succeeded and the caller
	 *          should treat this part as unchanged. `false` if a full
	 *          re-render is needed.
	 */
	tryIncrementalUpdate(newMarkdown: IChatMarkdownContent): boolean {
		if (!this._incrementalMorpher) {
			return false;
		}

		if (!equalsInlineReferences(newMarkdown.inlineReferences, this.markdown.inlineReferences)) {
			return false;
		}

		const success = this._incrementalMorpher.tryMorph(newMarkdown.content.value);

		if (success) {
			// Update the stored markdown so hasSameContent() returns true
			// for subsequent diffs with the same content, allowing the
			// progressive render to detect "caught up" and "complete" states.
			this.markdown = newMarkdown;
		}

		return success;
	}

	/**
	 * Forward the stream's word-rate estimate to the morpher's buffer.
	 */
	updateStreamRate(rate: number, isComplete: boolean): void {
		this._incrementalMorpher?.updateStreamRate(rate, isComplete);
	}

	layout(width: number): void {
		this.allRefs.forEach((ref, index) => {
			if (ref.object instanceof CodeBlockPart) {
				ref.object.layout(width);
			} else if (ref.object instanceof ChatOutputCodeBlockPart) {
				ref.object.layout(width);
			} else if (ref.object instanceof MarkdownDiffBlockPart) {
				ref.object.layout(width);
			} else if (ref.object instanceof CollapsedCodeBlock) {
				const codeblockModel = this._codeblocks[index];
				if (codeblockModel.codemapperUri && !isEqual(ref.object.uri, codeblockModel.codemapperUri)) {
					ref.object.render(codeblockModel.codemapperUri);
				}
			}
		});

		this.mathLayoutParticipants.forEach(layout => layout());
	}

	onDidRemount(): void {
		for (const ref of this.allRefs) {
			if (ref.object instanceof CodeBlockPart || ref.object instanceof ChatOutputCodeBlockPart) {
				ref.object.onDidRemount();
			}
		}
	}

	// ── 正文文件路径 linkify ─────────────────────────────────────────────────
	// test-workbench_change start

	/** 解析正文中的文件路径候选:绝对路径直接转链接;相对/裸名按工作区根解析,
	 *  存在性检查异步进行(模块级缓存去重,确认后触发一次补渲染)。
	 *  allowLinks=false(流式期间)只返回 undefined,不产生任何链接/重渲染。 */
	private _linkifyCandidate(candidate: string, allowLinks: boolean): string | undefined {
		const isAbsolute = candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate);
		const target = isAbsolute
			? URI.file(candidate.replace(/\\/g, '/'))
			: this._resolveWorkspaceTarget(candidate);
		if (!target || !allowLinks) { return undefined; }
		if (isAbsolute) {
			return this._asFileLink(target);
		}
		const cached = this._linkifyCache.get(candidate);
		if (cached === false) { return undefined; }
		if (cached === true) { return this._asFileLink(target); }
		if (cached !== 'pending') {
			this._linkifyCache.set(candidate, 'pending');
			void statFileRef(this.fileService, target).then(exists => {
				if (this._store.isDisposed) { return; }
				this._linkifyCache.set(candidate, exists);
				if (exists) { this._scheduleLinkifyRerender(); }
			});
		}
		return undefined;
	}

	private _resolveWorkspaceTarget(candidate: string): URI | undefined {
		// ponytail: 只按第一个工作区根解析,多根工作区命中后续根时不链接
		const root = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!root) { return undefined; }
		return root.with({ path: root.path.replace(/\/$/, '') + '/' + candidate });
	}

	private _asFileLink(uri: URI): string {
		const label = uri.path.split('/').filter(Boolean).pop() ?? uri.path;
		return `[${label}](${uri.with({ query: 'vscodeLinkType=file' }).toString()})`;
	}

	private _scheduleLinkifyRerender(): void {
		if (this._linkifyRerenderScheduled || this._store.isDisposed) { return; }
		this._linkifyRerenderScheduled = true;
		setTimeout(() => {
			this._linkifyRerenderScheduled = false;
			if (!this._store.isDisposed) { this._rerenderMarkdown?.(); }
		}, 0);
	}

	// test-workbench_change end

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}

function equalsInlineReferences(a: Record<string, IChatContentInlineReference> | undefined, b: Record<string, IChatContentInlineReference> | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return !a && !b;
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) {
		return false;
	}

	return aKeys.every(key => equalsInlineReference(a[key], b[key]));
}

function equalsInlineReference(a: IChatContentInlineReference | undefined, b: IChatContentInlineReference | undefined): boolean {
	if (!a || !b) {
		return !a && !b;
	}

	return a.resolveId === b.resolveId
		&& a.name === b.name
		&& equalsInlineReferenceValue(a.inlineReference, b.inlineReference);
}

type InlineReferenceValue = IChatContentInlineReference['inlineReference'];
type WorkspaceSymbolInlineReference = Extract<InlineReferenceValue, { name: string; location: unknown }>;
type WorkspaceSymbolComparer = (a: WorkspaceSymbolInlineReference, b: WorkspaceSymbolInlineReference) => boolean;

const workspaceSymbolComparers: { readonly [K in keyof WorkspaceSymbolInlineReference]-?: WorkspaceSymbolComparer } = {
	name: (a, b) => a.name === b.name,
	containerName: (a, b) => a.containerName === b.containerName,
	kind: (a, b) => a.kind === b.kind,
	tags: (a, b) => equalsSymbolTags(a.tags, b.tags),
	location: (a, b) => isEqual(a.location.uri, b.location.uri) && Range.equalsRange(a.location.range, b.location.range),
};

const workspaceSymbolComparerKeys = Object.keys(workspaceSymbolComparers) as (keyof WorkspaceSymbolInlineReference)[];

function equalsInlineReferenceValue(a: InlineReferenceValue, b: InlineReferenceValue): boolean {
	if (URI.isUri(a) || URI.isUri(b)) {
		return URI.isUri(a) && URI.isUri(b) && isEqual(a, b);
	}
	if (isLocation(a) || isLocation(b)) {
		return isLocation(a) && isLocation(b) && isEqual(a.uri, b.uri) && Range.equalsRange(a.range, b.range);
	}

	return equalsWorkspaceSymbol(a, b);
}

function equalsWorkspaceSymbol(a: WorkspaceSymbolInlineReference, b: WorkspaceSymbolInlineReference): boolean {
	return workspaceSymbolComparerKeys.every(key => workspaceSymbolComparers[key](a, b));
}

function equalsSymbolTags(a: readonly SymbolTag[] | undefined, b: readonly SymbolTag[] | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b || a.length !== b.length) {
		return false;
	}
	return a.every((tag, index) => tag === b[index]);
}

export function codeblockHasClosingBackticks(str: string): boolean {
	str = str.trim();
	return !!str.match(/\n```+$/);
}

class ChatOutputCodeBlockPart extends Disposable {

	static reuseKey(elementId: string, codeBlockIndex: number, identifier: string): string {
		return `${elementId}/${codeBlockIndex}/${identifier.toLowerCase()}`;
	}

	readonly element: HTMLElement;
	readonly reuseKey: string;

	private readonly _disposeCts = this._register(new CancellationTokenSource());
	private readonly _renderedOutputPart = this._register(new MutableDisposable<RenderedOutputPart>());

	constructor(
		private readonly identifier: string,
		private readonly text: string,
		codeBlockIndex: number,
		private readonly context: IChatContentPartRenderContext,
		private readonly isComplete: boolean,
		private readonly onDidChangeHeight: () => void,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatOutputRendererService private readonly chatOutputRendererService: IChatOutputRendererService,
		@IChatOutputPartStateCache private readonly stateCache: IChatOutputPartStateCache,
	) {
		super();
		this.reuseKey = ChatOutputCodeBlockPart.reuseKey(context.element.id, codeBlockIndex, identifier);

		const title = localize('chat.renderedCodeBlockLabel', "Rendered code block {0}", codeBlockIndex + 1);
		this.element = $('.interactive-result-code-block.chat-output-code-block.tool-output-part');
		this.element.tabIndex = -1;
		this.element.ariaLabel = title;

		const parent = $('.webview-output');
		parent.style.maxHeight = '80vh';
		parent.style.minHeight = '38px';
		this.element.appendChild(parent);

		const stateCacheKey = `codeBlock/${context.element.sessionResource.toString()}/${context.element.id}/${codeBlockIndex}/${identifier.toLowerCase()}`;
		const partState: IOutputPartState = this.stateCache.get(stateCacheKey) ?? { height: 0 };
		this.stateCache.set(stateCacheKey, partState);
		if (partState.height) {
			parent.style.height = `${partState.height}px`;
		}

		const progressMessage = $('span');
		progressMessage.textContent = localize('chat.codeBlockOutputRendering', "Rendering code block...");
		const progressPart = this._register(this.instantiationService.createInstance(ChatProgressSubPart, progressMessage, ThemeIcon.modify(Codicon.loading, 'spin'), undefined));
		parent.appendChild(progressPart.domNode);
		if (!isComplete) {
			this.onDidChangeHeight();
			return;
		}

		this.chatOutputRendererService.renderCodeBlock(identifier, new TextEncoder().encode(text), parent, {
			webviewState: partState.webviewState,
			title,
			chatSessionResource: this.context.element.sessionResource,
		}, this._disposeCts.token).then(renderedItem => {
			if (this._disposeCts.token.isCancellationRequested) {
				renderedItem.dispose();
				return;
			}

			this._renderedOutputPart.value = renderedItem;
			progressPart.domNode.remove();
			parent.style.minHeight = '';
			this.onDidChangeHeight();

			this._register(renderedItem.webview.onDidUpdateState(e => {
				partState.webviewState = e;
			}));

			this._register(renderedItem.onDidChangeHeight(newHeight => {
				partState.height = newHeight;
				this.onDidChangeHeight();
			}));
			this._register(this.context.onDidChangeVisibility(visible => {
				if (visible) {
					renderedItem.reinitialize();
				}
			}));
		}, error => {
			if (isCancellationError(error)) {
				return;
			}

			console.error('Error rendering chat code block:', error);
			progressPart.domNode.replaceWith(this.renderError(error));
			parent.style.minHeight = '';
			this.onDidChangeHeight();
		});
	}

	hasSameContent(identifier: string, text: string, isComplete: boolean): boolean {
		return identifier.toLowerCase() === this.identifier.toLowerCase()
			&& text === this.text
			&& isComplete === this.isComplete;
	}

	override dispose(): void {
		this._disposeCts.dispose(true);
		super.dispose();
	}

	layout(width: number): void {
		this.element.style.maxWidth = `${width}px`;
	}

	onDidRemount(): void {
		this._renderedOutputPart.value?.reinitialize();
	}

	focus(): void {
		const webview = this._renderedOutputPart.value?.webview;
		if (webview) {
			webview.focus();
		} else {
			this.element.focus();
		}
	}

	private renderError(error: Error): HTMLElement {
		const errorNode = $('.output-error');

		const errorHeaderNode = $('.output-error-header');
		dom.append(errorNode, errorHeaderNode);

		const iconElement = $('div');
		iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.error));
		errorHeaderNode.append(iconElement);

		const errorTitleNode = $('.output-error-title');
		errorTitleNode.textContent = localize('chat.codeBlockOutputError', "Error rendering the code block");
		errorHeaderNode.append(errorTitleNode);

		const errorMessageNode = $('.output-error-details');
		errorMessageNode.textContent = error?.message || String(error);
		errorNode.append(errorMessageNode);

		return errorNode;
	}
}

export class CollapsedCodeBlock extends ChatEditPillElement {

	private currentDiff: IEditSessionEntryDiff | undefined;
	get diff(): IEditSessionEntryDiff | undefined {
		return this.currentDiff;
	}

	private readonly _onDidChangeDiff = this._register(new Emitter<IEditSessionEntryDiff>());
	readonly onDidChangeDiff: Event<IEditSessionEntryDiff> = this._onDidChangeDiff.event;

	private readonly progressStore = this._store.add(new DisposableStore());

	constructor(
		private readonly sessionResource: URI,
		private readonly requestId: string,
		private readonly inUndoStop: string | undefined,
		@ILabelService labelService: ILabelService,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IMenuService private readonly menuService: IMenuService,
		@IHoverService hoverService: IHoverService,
		@IChatService private readonly chatService: IChatService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITextModelService private readonly textModelService: ITextModelService,
	) {
		super(labelService, modelService, languageService, hoverService);

		this._register(this.onDidClick(e => this.showDiff(e)));
		this._register(this.onDidContextMenu(event => {
			this.contextMenuService.showContextMenu({
				contextKeyService: this.contextKeyService,
				getAnchor: () => event,
				getActions: () => {
					if (!this.uri) {
						return [];
					}
					const menu = this.menuService.getMenuActions(MenuId.ChatEditingCodeBlockContext, this.contextKeyService, {
						arg: {
							sessionResource: this.sessionResource,
							requestId: this.requestId,
							uri: this.uri,
							stopId: this.inUndoStop,
						} satisfies ChatEditingActionContext,
					});
					return getFlatContextMenuActions(menu);
				},
			});
		}));
	}

	private async showDiff({ editorOptions: options, openToSide }: IOpenEditorOptions): Promise<void> {
		const group = openToSide ? SIDE_GROUP : undefined;
		if (this.currentDiff) {
			// If the change is a pure addition into a file whose original version did not
			// exist or was empty, there is nothing meaningful to diff against. Open the
			// file in a normal editor instead of a diff editor.
			if (this.currentDiff.removed === 0 && await isResourceContentEmpty(this.textModelService, this.currentDiff.originalURI) && this.uri) {
				this.editorService.openEditor({ resource: this.uri, options }, group);
				return;
			}
			this.editorService.openEditor({
				original: { resource: this.currentDiff.originalURI },
				modified: { resource: this.currentDiff.modifiedURI },
				options
			}, group);
		} else if (this.uri) {
			this.editorService.openEditor({ resource: this.uri, options }, group);
		}
	}

	/**
	 * @param uri URI of the file on-disk being changed
	 */
	render(uri: URI): void {
		this.progressStore.clear();

		this.setUri(uri);
		this.setStatus(undefined, '');
		this.setLabelDetail('');
		this.setProgressFill(undefined);

		const session = this.chatService.getSession(this.sessionResource);
		const editSession = session?.editingSession;
		if (!editSession) {
			return;
		}

		const diffObservable = derived(reader => {
			const entry = editSession.readEntry(uri, reader);
			return entry && editSession.getEntryDiffBetweenStops(entry.modifiedURI, this.requestId, this.inUndoStop);
		}).map((d, r) => d?.read(r));

		const isStreaming = derived(r => {
			const entry = editSession.readEntry(uri, r);
			const currentlyModified = entry?.isCurrentlyBeingModifiedBy.read(r);
			return !!currentlyModified && currentlyModified.responseModel.requestId === this.requestId && currentlyModified.undoStopId === this.inUndoStop;
		});

		// Set the icon/classes while edits are streaming
		const iconText = this.labelService.getUriBasenameLabel(uri);
		this.progressStore.add(autorun(r => {
			if (isStreaming.read(r)) {
				const codicon = ThemeIcon.modify(Codicon.loading, 'spin');
				this.setStatus(codicon, localize('chat.codeblock.applyingEdits', 'Applying edits'));
				const entry = editSession.readEntry(uri, r);
				const rwRatio = Math.floor((entry?.rewriteRatio.read(r) || 0) * 100);

				const showAnimation = this.configurationService.getValue<boolean>(ChatConfiguration.ShowCodeBlockProgressAnimation);
				if (showAnimation) {
					this.setProgressFill(rwRatio);
					this.setLabelDetail('');
				} else {
					this.setProgressFill(undefined);
					this.setLabelDetail(rwRatio === 0 || !rwRatio ? localize('chat.codeblock.generating', "Generating edits...") : localize('chat.codeblock.applyingPercentage', "({0}%)...", rwRatio));
				}
			} else {
				this.setStatus(Codicon.check, localize('chat.codeblock.edited', 'Edited'));
				this.setProgressFill(undefined);
				this.setLabelDetail('');
			}
		}));

		// Render the +/- diff
		this.progressStore.add(autorunSelfDisposable(r => {
			const changes = diffObservable.read(r);
			if (changes === undefined) {
				return;
			}

			if (changes && !changes?.identical && !changes?.quitEarly) {
				this.currentDiff = changes;
				this._onDidChangeDiff.fire(changes);
				this.setDiff({ added: changes.added, removed: changes.removed });
				const insertionsFragment = changes.added === 1 ? localize('chat.codeblock.insertions.one', "1 insertion") : localize('chat.codeblock.insertions', "{0} insertions", changes.added);
				const deletionsFragment = changes.removed === 1 ? localize('chat.codeblock.deletions.one', "1 deletion") : localize('chat.codeblock.deletions', "{0} deletions", changes.removed);
				this.setAriaLabel(localize('summary', 'Edited {0}, {1}, {2}', iconText, insertionsFragment, deletionsFragment));

				// No need to keep updating once we get the diff info
				if (changes.isFinal) {
					r.dispose();
				}
			}
		}));
	}
}

function fixCodeText(text: string, languageId: string | undefined): string {
	if (languageId === 'php') {
		// <?php or short tag version <?
		if (!text.trim().startsWith('<?')) {
			return `<?php\n${text}`;
		}
	}

	return text;
}

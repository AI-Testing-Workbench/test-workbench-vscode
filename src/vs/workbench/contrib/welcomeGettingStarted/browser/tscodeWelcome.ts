/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
// TSCode Welcome Page - Custom welcome page based on GettingStartedPage

import { GettingStartedPage } from './gettingStarted.js';
import { TscodeWelcomeInput } from './tscodeWelcomeInput.js';
import { createTscodeFaceSvg, pickRandomTscodeFaceType, TSCODE_FACE_TYPES } from './tscodeFaceIcon.js'; // test-workbench_change
import { IEditorSerializer, IEditorOpenContext } from '../../../common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { $ } from '../../../../base/browser/dom.js';
import { GettingStartedEditorOptions, GettingStartedInput } from './gettingStartedInput.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Memento } from '../../../common/memento.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IWalkthroughsService } from './gettingStartedService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js'; // test-workbench_change
import { ITsCodeTokenStore } from '../../tsCodeAuth/common/tsCodeAuth.js'; // test-workbench_change

interface TscodeWelcomeMemento {
	hasShownAnimation?: boolean;
	lastFaceType?: string;
}

export class TscodeWelcomePage extends GettingStartedPage {
	// Note: Cannot override parent class static ID, so we use a different ID during registration
	private parentElement?: HTMLElement;
	private iconAdded = false;
	private animationShown = false; // test-workbench_change
	private tscodeMemento!: Memento<TscodeWelcomeMemento>; // test-workbench_change - Use different name to avoid conflict with parent
	private tscodeMementoData!: Partial<TscodeWelcomeMemento>; // test-workbench_change
	private readonly tscodeStorageService: IStorageService; // test-workbench_change
	private readonly tscodeTokenStore: ITsCodeTokenStore; // test-workbench_change

	// test-workbench_change start - Constructor to inject storage service
	constructor(
		group: any,
		@ICommandService commandService: any,
		@IProductService productService: any,
		@IKeybindingService keybindingService: any,
		@IWalkthroughsService gettingStartedService: any,
		@IConfigurationService configurationService: any,
		@ITelemetryService telemetryService: any,
		@ILanguageService languageService: any,
		@IFileService fileService: any,
		@IOpenerService openerService: any,
		@IWorkbenchThemeService themeService: any,
		@IStorageService storageService: IStorageService,
		@IExtensionService extensionService: any,
		@IInstantiationService instantiationService: any,
		@INotificationService notificationService: any,
		@IEditorGroupsService groupsService: any,
		@IContextKeyService contextService: any,
		@IQuickInputService quickInputService: any,
		@IWorkspacesService workspacesService: any,
		@ILabelService labelService: any,
		@IHostService hostService: any,
		@IWebviewService webviewService: any,
		@IWorkspaceContextService workspaceContextService: any,
		@IAccessibilityService accessibilityService: any,
		@IMarkdownRendererService markdownRendererService: any,
		@IChatEntitlementService chatEntitlementService: any,
		@IDefaultAccountService defaultAccountService: IDefaultAccountService,
		@ITsCodeTokenStore tokenStore: ITsCodeTokenStore,
	) {
		super(
			group, commandService, productService, keybindingService, gettingStartedService,
			configurationService, telemetryService, languageService, fileService, openerService,
			themeService, storageService, extensionService, instantiationService, notificationService,
			groupsService, contextService, quickInputService, workspacesService, labelService,
			hostService, webviewService, workspaceContextService, accessibilityService, markdownRendererService,
			chatEntitlementService, defaultAccountService
		);
		this.tscodeStorageService = storageService;
		this.tscodeTokenStore = tokenStore; // test-workbench_change
	}
	// test-workbench_change end

	protected override createEditor(parent: HTMLElement): void {
		super.createEditor(parent);
		this.parentElement = parent;
		// Add custom styling for TSCode welcome page
		parent.classList.add('tscode-welcome');

		// test-workbench_change start - Initialize memento for storing animation state
		this.tscodeMemento = new Memento('tscodeWelcome', this.tscodeStorageService);
		this.tscodeMementoData = this.tscodeMemento.getMemento(StorageScope.APPLICATION, StorageTarget.USER);
		// test-workbench_change end

		// test-workbench_change start - Show opening animation
		this.showOpeningAnimation(parent);
		// test-workbench_change end
	}

	override async setInput(newInput: GettingStartedInput, options: GettingStartedEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		// Call parent implementation first
		await super.setInput(newInput, options, context, token);

		// Add icon after categories slide is built
		if (!this.iconAdded && this.parentElement) {
			// Use setTimeout to ensure DOM is fully rendered
			setTimeout(() => this.addProductIconToDOM(), 50);
		}
	}

	private findProductNameElement(element: HTMLElement): HTMLElement | null {
		// Recursively search for h1 element with product-name class
		if (element.tagName === 'H1' && element.classList.contains('product-name')) {
			return element;
		}

		for (let i = 0; i < element.children.length; i++) {
			const child = element.children[i] as HTMLElement;
			const found = this.findProductNameElement(child);
			if (found) {
				return found;
			}
		}

		return null;
	}

	// test-workbench_change start - Opening animation
	private async showOpeningAnimation(parent: HTMLElement): Promise<void> {
		// test-workbench_change start - Check if animation has been shown before
		if (this.tscodeMementoData.hasShownAnimation) {
			// Skip animation if it has been shown before
			return;
		}

		// test-workbench_change start - Skip animation if user has no token (not logged in)
		const storedToken = await this.tscodeTokenStore.getToken();
		if (!storedToken) {
			return;
		}
		// test-workbench_change end

		if (this.animationShown) {
			return;
		}
		this.animationShown = true;
		// test-workbench_change end

		// Create animation overlay
		const overlay = $('div.tscode-animation-overlay');
		overlay.style.position = 'fixed';
		overlay.style.top = '0';
		overlay.style.left = '0';
		overlay.style.width = '100%';
		overlay.style.height = '100%';
		overlay.style.backgroundColor = '#dff0ff';
		overlay.style.zIndex = '10000';
		overlay.style.display = 'flex';
		overlay.style.alignItems = 'flex-end';
		overlay.style.justifyContent = 'flex-end';

		// Add animation styles
		this.addAnimationStyles(overlay);

		// Build animation DOM structure
		this.buildAnimationStructure(overlay);

		parent.appendChild(overlay);

		// Hide the main content initially
		const mainContent = parent.querySelector('.gettingStarted') as HTMLElement;
		if (mainContent) {
			mainContent.style.opacity = '0';
		}

		// Start animation sequence
		this.startAnimationSequence(overlay, mainContent);
	}

	private addAnimationStyles(container: HTMLElement): void {
		const style = document.createElement('style');
		style.textContent = `
			.sticker-wrap { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: row; align-items: center; gap: 0; }
			.avatar-container { display: flex; flex-direction: column; align-items: center; position: relative; z-index: 10; }
			@keyframes shy-peek-side {
				0% { transform: scale(0.5) translateX(80px); opacity: 0; }
				12% { transform: scale(0.5) translateX(50px); opacity: 1; }
				28% { transform: scale(0.5) translateX(50px); opacity: 1; }
				35% { transform: scale(0.49) translateX(60px); opacity: 1; }
				45% { transform: scale(0.48) translateX(75px); opacity: 1; }
				52% { transform: scale(0.52) translateX(45px); opacity: 1; }
				64% { transform: scale(0.52) translateX(45px); opacity: 1; }
				75% { transform: scale(0.65) translateX(20px); opacity: 1; }
				88% { transform: scale(1.08) translateX(0); opacity: 1; }
				95% { transform: scale(0.96) translateX(0); opacity: 1; }
				100% { transform: scale(1) translateX(0); opacity: 1; }
			}
			.sticker { animation: shy-peek-side 2.6s cubic-bezier(0.34, 1.05, 0.64, 1) 0.3s both; transform-origin: center center; position: relative; width: 160px; height: 160px; }
			.wall { width: 80px; height: 180px; background: transparent; position: relative; flex-shrink: 0; margin-left: -20px; }
			.bubble { position: absolute; top: -50px; left: 50%; transform: translateX(-50%) scale(0.7) translateY(6px); background: #fff; border: 1.5px solid #b8d8f5; border-radius: 12px; padding: 5px 10px; font-size: 12px; color: #2979ff; white-space: nowrap; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease; z-index: 20; }
			.bubble::after { content: ''; position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); border: 5px solid transparent; border-top-color: #b8d8f5; }
			.bubble.show { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
			.face { position: absolute; inset: 0; opacity: 0; transition: opacity 0.3s ease; }
			.face.active { opacity: 1; }
			@keyframes bounce {
				0% { transform: translateY(0) scaleX(1) scaleY(1); }
				18% { transform: translateY(-22px) scaleX(0.9) scaleY(1.1); }
				32% { transform: translateY(0) scaleX(1.1) scaleY(0.9); }
				46% { transform: translateY(-14px) scaleX(0.93) scaleY(1.07); }
				58% { transform: translateY(0) scaleX(1.06) scaleY(0.94); }
				70% { transform: translateY(-7px) scaleX(0.97) scaleY(1.03); }
				80% { transform: translateY(0) scaleX(1.02) scaleY(0.98); }
				88% { transform: translateY(-3px) scaleX(1) scaleY(1); }
				100% { transform: translateY(0) scaleX(1) scaleY(1); }
			}
			.sticker.bouncing { animation: bounce 1.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards; transform-origin: center center; }
			@keyframes blink { 0%, 88%, 100% { ry: 2.62; } 93% { ry: 0.2; } }
			.can-blink { animation: blink 3.5s ease-in-out infinite; }
			@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
			.sticker.floating { animation: float 3s ease-in-out infinite; }
			@keyframes peek-eye-shy {
				0%, 8% { ry: 2.62; transform: translateX(0); }
				12% { ry: 2.62; transform: translateX(0); }
				20% { ry: 2.62; transform: translateX(-3px); }
				28% { ry: 2.62; transform: translateX(3px); }
				36% { ry: 2.62; transform: translateX(0); }
				40% { ry: 2.0; transform: translateX(0); }
				52% { ry: 2.4; transform: translateX(0); }
				60% { ry: 2.4; transform: translateX(-2.5px); }
				68% { ry: 2.4; transform: translateX(2.5px); }
				75% { ry: 2.62; transform: translateX(0); }
				100% { ry: 2.62; transform: translateX(0); }
			}
			.peek-eye { animation: peek-eye-shy 2.6s ease-in-out 0.3s both; }
			.enter-button-container {
				position: fixed;
				bottom: 15%;
				left: 50%;
				transform: translateX(calc(-50% - 30px)) translateY(20px);
				display: flex;
				justify-content: center;
				align-items: center;
				opacity: 0;
				transition: all 0.4s ease;
				z-index: 100;
			}
			.enter-button-container.show {
				opacity: 1;
				transform: translateX(calc(-50% - 30px)) translateY(0);
			}
			.enter-button {
				background: #ffffff;
				color: #2979ff;
				border: 2px solid #2979ff;
				border-radius: 8px;
				padding: 14px 48px;
				font-size: 16px;
				font-weight: 500;
				cursor: pointer;
				transition: all 0.2s ease;
				box-shadow: 0 2px 8px rgba(41, 121, 255, 0.15);
			}
			.enter-button:hover {
				background: #f0f7ff;
				border-color: #1565c0;
				color: #1565c0;
				box-shadow: 0 4px 12px rgba(41, 121, 255, 0.25);
				transform: translateY(-2px);
			}
			.enter-button:active {
				transform: translateY(0);
				box-shadow: 0 1px 4px rgba(41, 121, 255, 0.2);
			}
		`;
		container.appendChild(style);
	}

	private buildAnimationStructure(container: HTMLElement): void {
		const stickerWrap = $('div.sticker-wrap');
		const avatarContainer = $('div.avatar-container');
		const sticker = $('div.sticker');
		sticker.id = 'anime-sticker';

		const bubble = $('div.bubble');
		bubble.id = 'anime-bubble';
		sticker.appendChild(bubble);

		// Create all face SVGs
		sticker.appendChild(this.createFaceSVG('face-peek', 'active', true));
		sticker.appendChild(this.createFaceSVG('face-welcome', '', false));
		sticker.appendChild(this.createFaceSVG('face-happy', '', false));
		sticker.appendChild(this.createFaceSVG('face-default', '', false));

		avatarContainer.appendChild(sticker);
		stickerWrap.appendChild(avatarContainer);
		stickerWrap.appendChild($('div.wall'));
		container.appendChild(stickerWrap);

		// Create enter button container at the bottom of the page
		const buttonContainer = $('div.enter-button-container');
		buttonContainer.id = 'anime-button-container';
		const enterButton = document.createElement('button');
		enterButton.className = 'enter-button';
		enterButton.id = 'anime-enter-button';
		// allow-any-unicode-next-line
		enterButton.textContent = '进入工作台';
		buttonContainer.appendChild(enterButton);
		container.appendChild(buttonContainer);
	}

	private createFaceSVG(id: string, activeClass: string, isPeek: boolean): HTMLElement {
		const face = $(`div.face${activeClass ? '.' + activeClass : ''}`);
		face.id = id;

		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '-4 -4 32 32');
		svg.setAttribute('width', '160');
		svg.setAttribute('height', '160');

		const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
		const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
		gradient.setAttribute('id', `rg-${id}`);
		gradient.setAttribute('x1', '0%');
		gradient.setAttribute('y1', '0%');
		gradient.setAttribute('x2', '100%');
		gradient.setAttribute('y2', '100%');

		['#4fc3f7', '#2979ff', '#69f0ae'].forEach((color, i) => {
			const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
			stop.setAttribute('offset', `${i * 50}%`);
			stop.setAttribute('stop-color', color);
			gradient.appendChild(stop);
		});
		defs.appendChild(gradient);
		svg.appendChild(defs);

		const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		bgCircle.setAttribute('cx', '12');
		bgCircle.setAttribute('cy', '12');
		bgCircle.setAttribute('r', '12');
		bgCircle.setAttribute('fill', '#e8f4ff');
		svg.appendChild(bgCircle);

		const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		ring.setAttribute('cx', '12');
		ring.setAttribute('cy', '12');
		ring.setAttribute('r', '12.75');
		ring.setAttribute('fill', 'none');
		ring.setAttribute('stroke', `url(#rg-${id})`);
		ring.setAttribute('stroke-width', '1.5');
		svg.appendChild(ring);

		if (id === 'face-peek') {
			const eye1 = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			eye1.setAttribute('class', 'peek-eye');
			eye1.setAttribute('cx', '8');
			eye1.setAttribute('cy', '8.8');
			eye1.setAttribute('rx', '1.63');
			eye1.setAttribute('ry', '2.62');
			eye1.setAttribute('fill', '#2979ff');
			svg.appendChild(eye1);

			const eye2 = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			eye2.setAttribute('class', 'peek-eye');
			eye2.setAttribute('cx', '16');
			eye2.setAttribute('cy', '8.8');
			eye2.setAttribute('rx', '1.63');
			eye2.setAttribute('ry', '2.62');
			eye2.setAttribute('fill', '#2979ff');
			svg.appendChild(eye2);

			[{ cx: '8.7', cy: '7.8' }, { cx: '16.7', cy: '7.8' }].forEach(pos => {
				const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
				highlight.setAttribute('cx', pos.cx);
				highlight.setAttribute('cy', pos.cy);
				highlight.setAttribute('r', '0.6');
				highlight.setAttribute('fill', 'rgba(255,255,255,0.7)');
				svg.appendChild(highlight);
			});

			[{ cx: '6', cy: '13' }, { cx: '18', cy: '13' }].forEach(pos => {
				const blush = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
				blush.setAttribute('cx', pos.cx);
				blush.setAttribute('cy', pos.cy);
				blush.setAttribute('rx', '2.0');
				blush.setAttribute('ry', '1.0');
				blush.setAttribute('fill', 'rgba(100,180,255,0.25)');
				svg.appendChild(blush);
			});
		} else if (id === 'face-welcome') {
			[{ cx: '8', cy: '9.5' }, { cx: '16', cy: '9.5' }].forEach(pos => {
				const eye = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
				eye.setAttribute('cx', pos.cx);
				eye.setAttribute('cy', pos.cy);
				eye.setAttribute('r', '2.4');
				eye.setAttribute('fill', '#2979ff');
				svg.appendChild(eye);
			});
			[{ cx: '8.9', cy: '8.6' }, { cx: '16.9', cy: '8.6' }].forEach(pos => {
				const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
				highlight.setAttribute('cx', pos.cx);
				highlight.setAttribute('cy', pos.cy);
				highlight.setAttribute('r', '0.85');
				highlight.setAttribute('fill', 'rgba(255,255,255,0.75)');
				svg.appendChild(highlight);
			});
		} else if (id === 'face-happy') {
			['M6.5 10.5 Q8 8.2 9.5 10.5', 'M14.5 10.5 Q16 8.2 17.5 10.5'].forEach(d => {
				const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
				path.setAttribute('d', d);
				path.setAttribute('stroke', '#2979ff');
				path.setAttribute('stroke-width', '1.4');
				path.setAttribute('fill', 'none');
				path.setAttribute('stroke-linecap', 'round');
				svg.appendChild(path);
			});
		} else if (id === 'face-default') {
			[{ cx: '8', cy: '9.33' }, { cx: '16', cy: '9.33' }].forEach(pos => {
				const eye = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
				eye.setAttribute('class', 'can-blink');
				eye.setAttribute('cx', pos.cx);
				eye.setAttribute('cy', pos.cy);
				eye.setAttribute('rx', '1.63');
				eye.setAttribute('ry', '2.62');
				eye.setAttribute('fill', '#2979ff');
				svg.appendChild(eye);
			});
		}

		face.appendChild(svg);
		return face;
	}

	private startAnimationSequence(overlay: HTMLElement, mainContent: HTMLElement | null): void {
		const sticker = overlay.querySelector('#anime-sticker') as HTMLElement;
		const bubble = overlay.querySelector('#anime-bubble') as HTMLElement;
		const buttonContainer = overlay.querySelector('#anime-button-container') as HTMLElement;
		const enterButton = overlay.querySelector('#anime-enter-button') as HTMLElement;
		const facePeek = overlay.querySelector('#face-peek') as HTMLElement;
		const faceWelcome = overlay.querySelector('#face-welcome') as HTMLElement;
		const faceHappy = overlay.querySelector('#face-happy') as HTMLElement;
		const faceDefault = overlay.querySelector('#face-default') as HTMLElement;

		if (!sticker || !bubble || !enterButton || !buttonContainer) { return; }

		let bubbleTimer: any = null;
		let autoEnterTimer: any = null;

		const showFace = (el: HTMLElement) => {
			[facePeek, faceWelcome, faceHappy, faceDefault].forEach(f => f?.classList.remove('active'));
			el?.classList.add('active');
		};

		const showBubble = (text: string, duration: number) => {
			// allow-any-unicode-next-line
			// 清除之前的定时器
			if (bubbleTimer) {
				clearTimeout(bubbleTimer);
				bubbleTimer = null;
			}

			bubble.textContent = text;
			bubble.classList.add('show');

			if (duration > 0) {
				bubbleTimer = setTimeout(() => {
					bubble.classList.remove('show');
					bubbleTimer = null;
				}, duration);
			}
		};

		const enterWorkbench = () => {
			// allow-any-unicode-next-line
			// 清除自动进入定时器
			if (autoEnterTimer) {
				clearTimeout(autoEnterTimer);
				autoEnterTimer = null;
			}

			// test-workbench_change start - Mark animation as shown
			this.tscodeMementoData.hasShownAnimation = true;
			this.tscodeMemento.saveMemento();
			// test-workbench_change end

			overlay.style.transition = 'opacity 0.5s ease-out';
			overlay.style.opacity = '0';

			if (mainContent) {
				mainContent.style.transition = 'opacity 0.5s ease-in';
				mainContent.style.opacity = '1';
			}

			setTimeout(() => {
				overlay.remove();
			}, 500);
		};

		// allow-any-unicode-next-line
		// 按钮点击事件
		enterButton.addEventListener('click', enterWorkbench);

		setTimeout(() => {
			showFace(faceWelcome);
			sticker.classList.add('bouncing');
			// allow-any-unicode-next-line
			showBubble('你好呀！ヾ(≧▽≦*)o', 1400);
			sticker.addEventListener('animationend', () => sticker.classList.remove('bouncing'), { once: true });
		}, 3100);

		setTimeout(() => {
			showFace(faceHappy);
			sticker.classList.add('floating');
			// allow-any-unicode-next-line
			showBubble('我是测小智，希望可以帮助到你', 10000);
			// allow-any-unicode-next-line
			// 在笑脸出现时显示进入按钮
			buttonContainer.classList.add('show');
		}, 4500);

		setTimeout(() => {
			showFace(faceDefault);
		}, 14500);

		// allow-any-unicode-next-line
		// 自动进入工作台（20秒后，给用户足够时间看到按钮）
		autoEnterTimer = setTimeout(() => {
			enterWorkbench();
		}, 20500);
	}
	// test-workbench_change end

	private addProductIconToDOM(): void {
		if (!this.parentElement || this.iconAdded) {
			return;
		}

		const productNameElement = this.findProductNameElement(this.parentElement);

		if (productNameElement && !productNameElement.classList.contains('icon-added')) {
			productNameElement.classList.add('icon-added');
			this.iconAdded = true;

			// Randomly select a face type with timestamp-based seed for better randomness
			const faceTypes = TSCODE_FACE_TYPES; // test-workbench_change
			const randomFace = pickRandomTscodeFaceType(); // test-workbench_change
			let currentFaceIndex = faceTypes.indexOf(randomFace);

			console.log('TSCode Welcome: Selected random face:', randomFace, 'from index:', currentFaceIndex);

			// Create wrapper with floating animation
			const iconWrapper = $('span.product-icon-wrapper');
			iconWrapper.style.display = 'inline-flex';
			iconWrapper.style.cursor = 'pointer';
			iconWrapper.style.transition = 'transform 0.2s ease';
			iconWrapper.style.pointerEvents = 'auto';
			iconWrapper.style.userSelect = 'none';
			iconWrapper.style.overflow = 'visible'; // Allow glow to overflow

			iconWrapper.style.padding = '0';
			iconWrapper.style.boxSizing = 'border-box';

			iconWrapper.style.animation = 'float-tscode 3.2s ease-in-out infinite';

			// Create SVG element using DOM API
			const svg = createTscodeFaceSvg(randomFace);
			svg.style.marginRight = '12px'; // test-workbench_change
			svg.style.pointerEvents = 'none'; // Let clicks pass through to wrapper
			iconWrapper.appendChild(svg);

			// Add click event to cycle through faces
			iconWrapper.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();

				currentFaceIndex = (currentFaceIndex + 1) % faceTypes.length;
				const newFace = faceTypes[currentFaceIndex];
				console.log('TSCode Welcome: Clicked! Switched to face:', newFace);

				// Clear existing content using DOM API (not innerHTML for security)
				while (iconWrapper.firstChild) {
					iconWrapper.removeChild(iconWrapper.firstChild);
				}

				// Update filter for thinking face // test-workbench_changes
				iconWrapper.style.padding = '0';
				iconWrapper.style.boxSizing = 'border-box';

				// Create new SVG
				const newSvg = createTscodeFaceSvg(newFace);
				newSvg.style.marginRight = '12px'; // test-workbench_change
				newSvg.style.pointerEvents = 'none';
				iconWrapper.appendChild(newSvg);
			}, true); // Use capture phase

			// Add hover effect
			iconWrapper.addEventListener('mouseenter', () => {
				iconWrapper.style.transform = 'scale(1.1)';
			});

			iconWrapper.addEventListener('mouseleave', () => {
				iconWrapper.style.transform = 'scale(1)';
			});

			// Add floating animation style to document
			this.addFloatingAnimationStyle();

			// Create icon container
			const iconSpan = $('span.product-icon');
			iconSpan.appendChild(iconWrapper);

			// Insert icon before the text content
			const textContent = productNameElement.textContent;
			productNameElement.textContent = '';
			productNameElement.appendChild(iconSpan);
			productNameElement.appendChild(document.createTextNode(textContent || ''));

			// Add flex display to align icon and text
			productNameElement.style.display = 'flex';
			productNameElement.style.alignItems = 'center';
		}
	}

	private addFloatingAnimationStyle(): void {
		// Check if style already exists
		if (document.getElementById('tscode-float-animation')) {
			return;
		}

		const style = document.createElement('style');
		style.id = 'tscode-float-animation';
		style.textContent = `
			@keyframes float-tscode {
				0%, 100% { transform: translateY(0px); }
				50% { transform: translateY(-4px); }
			}
		`;
		document.head.appendChild(style);
	}
}

export class TscodeWelcomeInputSerializer implements IEditorSerializer {
	public canSerialize(_editorInput: TscodeWelcomeInput): boolean {
		return true;
	}

	public serialize(editorInput: TscodeWelcomeInput): string {
		return JSON.stringify({ selectedCategory: editorInput.selectedCategory, selectedStep: editorInput.selectedStep });
	}

	public deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): TscodeWelcomeInput {
		return instantiationService.invokeFunction(_accessor => {
			try {
				const { selectedCategory, selectedStep } = JSON.parse(serializedEditorInput);
				return new TscodeWelcomeInput({ selectedCategory, selectedStep });
			} catch { }
			return new TscodeWelcomeInput({});
		});
	}
}

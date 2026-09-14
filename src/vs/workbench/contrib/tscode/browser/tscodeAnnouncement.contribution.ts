/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file
// TSCode announcement popup (公告弹窗)

import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IHeaders } from '../../../../base/parts/request/common/request.js';
import { decodeProductUrl } from '../../../../base/common/productEncoding.js';
import * as nls from '../../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IDialogService, IPromptButton } from '../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { TSCODE_EMPLOYEE_ID_STORAGE_KEY } from '../../tsCodeAuth/common/tsCodeAuth.js';

// test-workbench_change start - 公告接口地址（写死在代码中，不依赖 product.json）
// test-workbench_change start - 公告接口地址（base64 编码存储，使用前解码）
const ANNOUNCEMENT_API_URL_BASE64 = 'aHR0cHM6Ly90c2NvZGUtZ2F0ZXdheS5wYWFzdWF0LmNtYmNoaW5hLmNuL2Fubm91bmNlbWVudA==';
const ANNOUNCEMENT_API_URL = decodeProductUrl(ANNOUNCEMENT_API_URL_BASE64);

const SEEN_ANNOUNCEMENTS_KEY = 'tscode-announcement.seen';
// test-workbench_change end

interface IAnnouncement {
	id: string;
	type: 'notice' | 'recommend';
	title: string;
	content: string;
	linkUrl?: string;
	updatedAt?: string;
}

/**
 * 公告弹窗 Contribution。
 *
 * 每次启动时向服务端请求一次激活公告（每次启动仅请求一次），
 * 弹出过（已记录 id）的公告不再展示。
 * 服务端通过 X-Employee-ID 控制测试人员可见范围。
 */
class TscodeAnnouncementContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.tscodeAnnouncement';

	private _checked = false;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.checkAnnouncement();
	}

	private async checkAnnouncement(): Promise<void> {
		if (this._checked) {
			return;
		}
		this._checked = true;

		try {
			const headers: IHeaders = {};
			const employeeId = this.storageService.get(TSCODE_EMPLOYEE_ID_STORAGE_KEY, StorageScope.APPLICATION);
			if (employeeId) {
				headers['X-Employee-ID'] = employeeId;
			}

			const response = await this.requestService.request(
				{ url: ANNOUNCEMENT_API_URL, type: 'GET', headers, callSite: 'tscodeAnnouncement.fetchAnnouncement' },
				CancellationToken.None
			);
			const announcement = await asJson<IAnnouncement | null>(response);

			if (!announcement || !announcement.id) {
				return;
			}

			if (this.getSeenAnnouncementIds().has(announcement.id)) {
				return;
			}

			await this.showAnnouncement(announcement);
			this.markAnnouncementSeen(announcement.id);
		} catch (err) {
			this.logService.warn('[TscodeAnnouncement] failed to fetch announcement', err);
		}
	}

	private async showAnnouncement(announcement: IAnnouncement): Promise<void> {
		const buttons: IPromptButton<void>[] = [];

		if (announcement.linkUrl) {
			const linkUrl = announcement.linkUrl;
			buttons.push({
				// allow-any-unicode-next-line
				label: nls.localize('tscode.announcement.viewDetail', "查看详情"),
				run: () => {
					this.openerService.open(URI.parse(linkUrl));
				}
			});
		}

		buttons.push({
			// allow-any-unicode-next-line
			label: nls.localize('tscode.announcement.gotIt', "知道了"),
			run: () => { }
		});

		await this.dialogService.prompt<void>({
			type: 'info',
			message: announcement.title,
			buttons,
			custom: {
				markdownDetails: [{ markdown: new MarkdownString(announcement.content, true) }]
			}
		});
	}

	private getSeenAnnouncementIds(): Set<string> {
		const raw = this.storageService.get(SEEN_ANNOUNCEMENTS_KEY, StorageScope.APPLICATION, '[]');
		try {
			const arr = JSON.parse(raw);
			return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
		} catch {
			return new Set();
		}
	}

	private markAnnouncementSeen(id: string): void {
		const seen = this.getSeenAnnouncementIds();
		seen.add(id);
		this.storageService.store(SEEN_ANNOUNCEMENTS_KEY, JSON.stringify([...seen]), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}

registerWorkbenchContribution2(TscodeAnnouncementContribution.ID, TscodeAnnouncementContribution, WorkbenchPhase.AfterRestored); // test-workbench_change

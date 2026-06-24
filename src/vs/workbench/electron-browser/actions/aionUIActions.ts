/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { localize2 } from '../../../nls.js';
import { Action2 } from '../../../platform/actions/common/actions.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../platform/native/common/native.js';
import { join } from '../../../base/common/path.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INativeWorkbenchEnvironmentService } from '../../services/environment/electron-browser/environmentService.js';

export class OpenAionUIApplicationAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.openAionUI',
			title: localize2('openAionUI', 'Open AionUI'),
			tooltip: localize2('openAionUITooltip', 'Open AionUI Application'),
			f1: false,
			icon: Codicon.rocket,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const logService = accessor.get(ILogService);
		const fileService = accessor.get(IFileService);
		const nativeHostService = accessor.get(INativeHostService);
		const environmentService = accessor.get(INativeWorkbenchEnvironmentService);

		// Use userDataPath to store AionUi in user configuration directory
		const userDataPath = environmentService.userDataPath;
		const subAppBaseDir = join(userDataPath, 'AionUi');
		logService.info(`[AionUI] Launching AionUI application from: ${subAppBaseDir}`);

		const subAppPath = await this.getSubAppPath(subAppBaseDir, fileService, logService, nativeHostService);

		if (subAppPath) {
			try {
				logService.info(`[AionUI] Opening: ${subAppPath}`);
				await nativeHostService.launchExternalApp(subAppPath);
				logService.info('[AionUI] launchExternalApp called successfully');
			} catch (error) {
				logService.error('[AionUI] Error opening AionUI:', error);
			}
		} else {
			logService.warn('[AionUI] AionUi.exe not found, nothing to launch');
		}
	}

	private async getSubAppPath(subAppBaseDir: string, fileService: IFileService, logService: ILogService, nativeHostService: INativeHostService): Promise<string | undefined> {
		try {
			// Step 1: Ensure AionUi directory exists
			try {
				await fileService.stat(URI.file(subAppBaseDir));
			} catch {
				await fileService.createFolder(URI.file(subAppBaseDir));
			}

			// Step 2: Check if AionUi.exe already exists
			const exePath = join(subAppBaseDir, 'AionUi.exe');
			try {
				await fileService.stat(URI.file(exePath));
				logService.info(`[AionUI] Found existing AionUi.exe at: ${exePath}`);
				return exePath;
			} catch {
				// Not found, continue to download and extract
			}

			// Step 3: Check if AionUi.zip exists, download if not
			const zipPath = join(subAppBaseDir, 'AionUi.zip');
			try {
				await fileService.stat(URI.file(zipPath));
			} catch {
				logService.info(`[AionUI] Downloading AionUi.zip...`);
				await nativeHostService.downloadFile('http://localhost:8000/AionUi.zip', zipPath);
			}

			// Step 4: Extract the zip
			logService.info(`[AionUI] Extracting AionUi.zip to: ${subAppBaseDir}`);
			await nativeHostService.extractZipFile(zipPath, subAppBaseDir);

			// Step 5: Verify extraction was successful
			await fileService.stat(URI.file(exePath));
			logService.info(`[AionUI] Extraction successful, SubApp.exe at: ${exePath}`);
			return exePath;
		} catch (error) {
			logService.error('[AionUI] Error in getSubAppPath:', error);
			return undefined;
		}
	}
}

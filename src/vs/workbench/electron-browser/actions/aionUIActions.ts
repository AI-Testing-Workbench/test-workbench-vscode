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
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';

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

		logService.info('[AionUI] Launching AionUI application...');
		const subAppPath = await this.getSubAppPath(fileService, logService);

		if (subAppPath) {
			try {
				logService.info(`[AionUI] Opening: ${subAppPath}`);
				const fileUri = URI.file(subAppPath).toString();
				await nativeHostService.openExternal(fileUri);
				logService.info('[AionUI] openExternal called successfully');
			} catch (error) {
				logService.error('[AionUI] Error opening AionUI:', error);
			}
		} else {
			logService.warn('[AionUI] SubApp.exe not found, nothing to launch');
		}
	}

	private async getSubAppPath(fileService: IFileService, logService: ILogService): Promise<string | undefined> {
		try {
			const cwd = process.cwd();
			logService.info(`[AionUI] Searching for SubApp.exe, cwd: ${cwd}`);

			// Step 1: Check if sub-app/SubApp.exe already exists (possibly extracted before)
			const directPath = join(cwd, 'sub-app', 'SubApp.exe');
			try {
				await fileService.stat(URI.file(directPath));
				logService.info(`[AionUI] Found existing SubApp.exe at: ${directPath}`);
				return directPath;
			} catch {
				logService.trace(`[AionUI] SubApp.exe not found at: ${directPath}, checking zip...`);
			}

			// Step 2: Check if sub-app.zip exists
			const zipPath = join(cwd, 'sub-app.zip');
			try {
				await fileService.stat(URI.file(zipPath));
				logService.info(`[AionUI] Found zip at: ${zipPath}`);
			} catch {
				logService.warn(`[AionUI] sub-app.zip not found at: ${zipPath}`);
				return undefined;
			}

			// Step 3: Extract from zip to temp directory
			try {
				const tmpdir = require('os').tmpdir();
				const tempDir = join(tmpdir, `vscode-subapp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
				const targetPath = join(tempDir, 'SubApp.exe');

				logService.info(`[AionUI] Extracting sub-app/SubApp.exe from zip to: ${tempDir}`);
				const { extract } = await import('../../../base/node/zip.js');
				await extract(zipPath, tempDir, { sourcePath: 'sub-app/SubApp.exe' }, CancellationToken.None);

				// Step 4: Verify extraction was successful
				try {
					await fileService.stat(URI.file(targetPath));
					logService.info(`[AionUI] Extraction successful, SubApp.exe at: ${targetPath}`);
					return targetPath;
				} catch {
					logService.error(`[AionUI] Extraction completed but SubApp.exe not found at: ${targetPath}`);
					return undefined;
				}
			} catch (error) {
				logService.error('[AionUI] Error extracting SubApp.exe from zip:', error);
				return undefined;
			}
		} catch (error) {
			logService.error('[AionUI] Unexpected error in getSubAppPath:', error);
			return undefined;
		}
	}
}

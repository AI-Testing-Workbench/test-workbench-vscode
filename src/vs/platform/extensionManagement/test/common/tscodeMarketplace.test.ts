/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file - tests for the VS Code Marketplace URL conversion helpers

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getVsCodeMarketplaceAsset, getVsCodeMarketplaceDownloadAsset, getVsCodeMarketplaceManifest, isVsCodeMarketplaceManifest, isVsCodeMarketplaceRawAssetUri, VsCodeMarketplaceServiceUrl } from '../../common/tscodeMarketplace.js';

suite('TsCode VS Code Marketplace helpers', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('isVsCodeMarketplaceRawAssetUri detects unreachable marketplace CDN hosts', () => {
		assert.strictEqual(isVsCodeMarketplaceRawAssetUri('https://bpruitt-goddard.gallery.vsassets.io/_apis/public/gallery/publisher/bpruitt-goddard/extension/mermaid-markdown-syntax-highlighting/1.8.1/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage'), true);
		assert.strictEqual(isVsCodeMarketplaceRawAssetUri('https://ms-python.gallery.vsassets.io/_apis/public/gallery/publisher/ms-python/extension/python/2026.4.0/assetbyname'), true);
		assert.strictEqual(isVsCodeMarketplaceRawAssetUri('https://oracle.gallerycdn.azure.cn/extensions/oracle/oracle-java/26.0.2/1787240625549'), true);
		assert.strictEqual(isVsCodeMarketplaceRawAssetUri('https://tscode-vsx-registry.paasuat.cmbchina.cn/vscode/gallery/publishers/x/y/latest'), false);
		assert.strictEqual(isVsCodeMarketplaceRawAssetUri(undefined), false);
	});

	test('getVsCodeMarketplaceDownloadAsset converts to a reachable download url', () => {
		// Example 1: with a target platform query parameter
		const withTargetPlatform = getVsCodeMarketplaceDownloadAsset('bpruitt-goddard', 'mermaid-markdown-syntax-highlighting', '1.8.1', 'win32-x64');
		assert.strictEqual(withTargetPlatform.uri, `${VsCodeMarketplaceServiceUrl}/publishers/bpruitt-goddard/vsextensions/mermaid-markdown-syntax-highlighting/1.8.1/vspackage?targetPlatform=win32-x64`);
		assert.strictEqual(withTargetPlatform.fallbackUri, withTargetPlatform.uri);

		// Example 2: without a target platform query parameter
		const withoutTargetPlatform = getVsCodeMarketplaceDownloadAsset('ms-python', 'python', '2026.4.0');
		assert.strictEqual(withoutTargetPlatform.uri, `${VsCodeMarketplaceServiceUrl}/publishers/ms-python/vsextensions/python/2026.4.0/vspackage`);
		assert.strictEqual(withoutTargetPlatform.fallbackUri, withoutTargetPlatform.uri);
	});

	test('getVsCodeMarketplaceAsset builds a reachable content asset url', () => {
		const asset = getVsCodeMarketplaceAsset('17ce260e-a479-4289-b71d-93cf366d3708', '26.0.2', 'Microsoft.VisualStudio.Services.Content.Details');
		assert.strictEqual(asset.uri, `${VsCodeMarketplaceServiceUrl}/extensions/17ce260e-a479-4289-b71d-93cf366d3708/26.0.2/assets/Microsoft.VisualStudio.Services.Content.Details`);
		assert.strictEqual(asset.fallbackUri, asset.uri);
	});

	test('getVsCodeMarketplaceManifest builds a manifest for the VS Code Marketplace', () => {
		const manifest = getVsCodeMarketplaceManifest();
		assert.ok(manifest);
		assert.strictEqual(isVsCodeMarketplaceManifest(manifest), true);
	});

});

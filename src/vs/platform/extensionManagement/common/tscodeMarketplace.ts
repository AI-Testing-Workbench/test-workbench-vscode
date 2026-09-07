/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file - helpers for searching/installing extensions from the public VS Code Marketplace

import { buildExtensionGalleryManifest } from './extensionGalleryManifestService.js';
import { getExtensionGalleryManifestResourceUri, ExtensionGalleryResourceType, IExtensionGalleryManifest } from './extensionGalleryManifest.js';
import { GalleryMarketplace, IGalleryExtensionAsset } from './extensionManagement.js';

export const VsCodeMarketplaceServiceUrl = 'https://marketplace.visualstudio.com/_apis/public/gallery'; // test-workbench_change
export const VsCodeMarketplaceItemUrl = 'https://marketplace.visualstudio.com/items'; // test-workbench_change
export const VsCodeMarketplacePublisherUrl = 'https://marketplace.visualstudio.com/publishers'; // test-workbench_change

export function getVsCodeMarketplaceGalleryLabel(marketplace: GalleryMarketplace): string { // test-workbench_change
	// allow-any-unicode-next-line
	return marketplace === GalleryMarketplace.VsCodeOfficial ? 'VSCode市场' : '内网仓库';
}

/**
 * Builds the gallery manifest for the public VS Code Marketplace.
 */
export function getVsCodeMarketplaceManifest(): IExtensionGalleryManifest | null { // test-workbench_change
	return buildExtensionGalleryManifest({
		serviceUrl: VsCodeMarketplaceServiceUrl,
		itemUrl: VsCodeMarketplaceItemUrl,
		publisherUrl: VsCodeMarketplacePublisherUrl,
		resourceUrlTemplate: '',
		extensionUrlTemplate: '',
		controlUrl: '',
		nlsBaseUrl: '',
	});
}

/**
 * Returns true when the manifest is built for the public VS Code Marketplace.
 */
export function isVsCodeMarketplaceManifest(manifest: IExtensionGalleryManifest | null): boolean { // test-workbench_change
	if (!manifest) {
		return false;
	}
	const queryUri = getExtensionGalleryManifestResourceUri(manifest, ExtensionGalleryResourceType.ExtensionQueryService);
	return !!queryUri && queryUri.startsWith(VsCodeMarketplaceServiceUrl);
}

function getHost(uri: string): string { // test-workbench_change
	const match = /^https?:\/\/([^/]+)/.exec(uri);
	return match ? match[1] : '';
}

/**
 * Returns true when the given asset uri points to the public VS Code Marketplace CDN hosts
 * (`*.gallery.vsassets.io` / `*.gallerycdn.azure.cn`) which are usually not reachable inside the
 * corporate network. In that case the asset uris returned by the marketplace search response have
 * to be rewritten to the reachable `marketplace.visualstudio.com` endpoints.
 */
export function isVsCodeMarketplaceRawAssetUri(uri: string | undefined): boolean { // test-workbench_change
	if (!uri) {
		return false;
	}
	const host = getHost(uri).toLowerCase();
	return host === 'gallery.vsassets.io'
		|| host.endsWith('.gallery.vsassets.io')
		|| host === 'gallerycdn.azure.cn'
		|| host.endsWith('.gallerycdn.azure.cn');
}

/**
 * Builds a reachable asset uri for an extension of the public VS Code Marketplace, e.g.
 * `https://marketplace.visualstudio.com/_apis/public/gallery/extensions/{extensionId}/{version}/assets/{assetType}`.
 */
export function getVsCodeMarketplaceAsset(extensionId: string, version: string, assetType: string): IGalleryExtensionAsset { // test-workbench_change
	const uri = `${VsCodeMarketplaceServiceUrl}/extensions/${extensionId}/${version}/assets/${assetType}`;
	return { uri, fallbackUri: uri };
}

/**
 * Builds a reachable download uri for an extension of the public VS Code Marketplace, e.g.
 * `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/{publisher}/vsextensions/{name}/{version}/vspackage`.
 */
export function getVsCodeMarketplaceDownloadAsset(publisher: string, name: string, version: string, targetPlatform?: string): IGalleryExtensionAsset { // test-workbench_change
	const uri = `${VsCodeMarketplaceServiceUrl}/publishers/${publisher}/vsextensions/${name}/${version}/vspackage${targetPlatform ? `?targetPlatform=${targetPlatform}` : ''}`;
	return { uri, fallbackUri: uri };
}

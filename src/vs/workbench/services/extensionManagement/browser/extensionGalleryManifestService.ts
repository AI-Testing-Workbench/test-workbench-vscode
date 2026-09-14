/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionGalleryManifest, IExtensionGalleryManifestService } from '../../../../platform/extensionManagement/common/extensionGalleryManifest.js'; // test-workbench_change
import { ExtensionGalleryManifestService } from '../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';

class WebExtensionGalleryManifestService extends ExtensionGalleryManifestService implements IExtensionGalleryManifestService {

	constructor(
		@IProductService productService: IProductService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
	) {
		super(productService);
		const remoteConnection = remoteAgentService.getConnection();
		if (remoteConnection) {
			const channel = remoteConnection.getChannel('extensionGalleryManifest');
			this.getExtensionGalleryManifest().then(manifest => {
				channel.call('setExtensionGalleryManifest', [manifest]);
				this._register(this.onDidChangeExtensionGalleryManifest((manifest: IExtensionGalleryManifest | null) => channel.call('setExtensionGalleryManifest', [manifest]))); // test-workbench_change - annotate manifest param
			});
		}
	}

}

registerSingleton(IExtensionGalleryManifestService, WebExtensionGalleryManifestService, InstantiationType.Delayed);

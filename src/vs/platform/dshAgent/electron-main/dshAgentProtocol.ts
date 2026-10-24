/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { Session } from 'electron';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { DSH_AGENT_SCHEME, renderDshAgentErrorDocument } from '../common/dshAgent.js';
import { forwardDshAgentRequest, IDshAgentProxyTarget } from '../node/dshAgentProxy.js';

/** Supplies the authenticated Host target, or an error while the Host is unavailable. */
export interface IDshAgentProtocolTarget {
	getTarget(): IDshAgentProxyTarget | undefined;
	getError(): string | undefined;
}

/** Install the protocol handler on the Agent window's own session. */
export function installDshAgentProtocol(target: IDshAgentProtocolTarget, session: Session): IDisposable {
	const handler = async (request: Request): Promise<Response> => {
		const proxy = target.getTarget();
		if (!proxy) {
			const message = target.getError() ?? 'dsh Agent Host is not ready';
			return new Response(request.method === 'HEAD' ? null : renderDshAgentErrorDocument(message), {
				status: 503,
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'`,
					'x-content-type-options': 'nosniff',
					'cache-control': 'no-store'
				}
			});
		}
		try {
			return await forwardDshAgentRequest(request, proxy);
		} catch (error) {
			return new Response(request.method === 'HEAD' ? null : renderDshAgentErrorDocument(error instanceof Error ? error.message : String(error)), {
				status: 502,
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'`,
					'x-content-type-options': 'nosniff',
					'cache-control': 'no-store'
				}
			});
		}
	};
	session.protocol.handle(DSH_AGENT_SCHEME, handler);
	return toDisposable(() => {
		if (session.protocol.isProtocolHandled(DSH_AGENT_SCHEME)) {
			session.protocol.unhandle(DSH_AGENT_SCHEME);
		}
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

import { DSH_AGENT_AUTHORITY, DSH_AGENT_SCHEME, resolveDshAgentRequestPath } from '../common/dshAgent.js';

/** Authenticated Host origin and cookie used for every proxied request. */
export interface IDshAgentProxyTarget {
	readonly origin: string;
	readonly cookie: string;
}

const DSH_AGENT_ORIGIN_SOURCE = `${DSH_AGENT_SCHEME}:`;

/** Response headers that describe the main-process connection rather than the resource. */
export const WITHHELD_RESPONSE_HEADERS: readonly string[] = [
	'set-cookie',
	'content-encoding', 'content-length',
	'transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade',
	'proxy-authenticate', 'proxy-authorization'
];

/** Request headers replaced or removed before the request reaches the Host. */
const WITHHELD_REQUEST_HEADERS: readonly string[] = [
	'host', 'origin', 'cookie', 'sec-fetch-site', 'connection', 'content-length', 'transfer-encoding'
];

/**
 * Content policy for the Agent document. The Host page is trusted application code
 * served from the Agent origin; everything else is denied by default.
 */
export function dshAgentContentSecurityPolicy(hostOrigin: string): string {
	const wsOrigin = hostOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
	return [
		`default-src 'self'`,
		// The dsh client evaluates small expression payloads at runtime (plugin
		// configuration and client boot), so `unsafe-eval` is required by the
		// upstream frontend. The Host index is first-party code.
		`script-src 'self' 'unsafe-inline' 'unsafe-eval' ${DSH_AGENT_ORIGIN_SOURCE}`,
		`style-src 'self' 'unsafe-inline' ${DSH_AGENT_ORIGIN_SOURCE}`,
		`img-src 'self' data: blob: ${DSH_AGENT_ORIGIN_SOURCE} https:`,
		`font-src 'self' data: ${DSH_AGENT_ORIGIN_SOURCE}`,
		`media-src 'self' blob: data:`,
		`worker-src 'self' blob:`,
		`frame-src 'self' blob: data: ${DSH_AGENT_ORIGIN_SOURCE}`,
		`connect-src 'self' ${DSH_AGENT_ORIGIN_SOURCE} ${hostOrigin} ${wsOrigin}`,
		`object-src 'none'`,
		`base-uri 'self'`,
		`form-action 'none'`
	].join('; ');
}

/**
 * Forward one application request to the Host without exposing the Host token,
 * preserving streaming and cancellation.
 */
export async function forwardDshAgentRequest(request: Request, target: IDshAgentProxyTarget, fetchImpl: typeof fetch = fetch): Promise<Response> {
	const method = request.method.toUpperCase();
	if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
		return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST, PUT, PATCH, DELETE' } });
	}
	const source = new URL(request.url);
	if (source.hostname !== DSH_AGENT_AUTHORITY) {
		return new Response(null, { status: 404 });
	}
	const path = resolveDshAgentRequestPath(source.pathname);
	if (path === undefined) {
		return new Response(null, { status: 400 });
	}
	const targetUrl = new URL(target.origin);
	targetUrl.pathname = path;
	targetUrl.search = source.search;

	const headers = new Headers(request.headers);
	for (const name of WITHHELD_REQUEST_HEADERS) {
		headers.delete(name);
	}
	headers.set('cookie', target.cookie);

	const init: RequestInit = {
		method,
		headers,
		signal: request.signal,
		redirect: 'manual'
	};
	if (method !== 'GET' && method !== 'HEAD' && request.body !== null) {
		init.body = request.body;
		(init as RequestInit & { duplex: 'half' }).duplex = 'half';
	}
	const response = await fetchImpl(targetUrl.toString(), init);
	const outgoing = new Headers(response.headers);
	for (const name of WITHHELD_RESPONSE_HEADERS) {
		outgoing.delete(name);
	}
	if (path.startsWith('/plugins/')) {
		// Plugin bundles are addressed by a per-process revision, so the Chromium
		// cache can only accumulate entries no later launch can use.
		outgoing.set('cache-control', 'no-store');
	}
	const contentType = outgoing.get('content-type') ?? '';
	if (path === '/' || contentType.includes('text/html')) {
		outgoing.set('content-security-policy', dshAgentContentSecurityPolicy(target.origin));
		outgoing.set('x-content-type-options', 'nosniff');
		outgoing.set('referrer-policy', 'no-referrer');
		outgoing.set('x-frame-options', 'DENY');
	}
	return new Response(method === 'HEAD' ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: outgoing
	});
}

/** Build the authenticated Host origin and cookie from a ready URL. */
export function createProxyTarget(origin: string, cookie: string): IDshAgentProxyTarget {
	const url = new URL(origin);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Unsupported dsh Agent Host protocol: ${url.protocol}`);
	}
	if (cookie.length === 0) {
		throw new Error('dsh Agent Host cookie is empty');
	}
	return { origin: url.origin, cookie };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file

import type * as http from 'http';
import type { AddressInfo } from 'net';

/**
 * A tool the bridge offers to the testagent backend, already expressed in MCP terms.
 */
export interface IMcpToolSpec {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema: Record<string, unknown>;
}

/** Outcome of a tool call, expressed as MCP content blocks. */
export interface IMcpToolResult {
	readonly content: Array<Record<string, unknown>>;
	readonly isError?: boolean;
}

/** Supplies the tools a server exposes and executes a call on the host's behalf. */
export interface IMcpToolProvider {
	list(): IMcpToolSpec[];
	call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<IMcpToolResult>;
}

/**
 * Versions we are willing to negotiate. The client rejects an `initialize` result
 * whose version it does not know, so the requested version is only echoed when it
 * is listed here.
 */
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
const FALLBACK_VERSION = '2025-03-26';
const MAX_BODY_BYTES = 32 * 1024 * 1024;

interface IJsonRpcRequest {
	id?: unknown;
	method?: unknown;
	params?: unknown;
}

class MethodError extends Error {
	constructor(readonly code: number, message: string) {
		super(message);
		this.name = 'MethodError';
	}
}

/**
 * Minimal stateless MCP server speaking the Streamable HTTP transport.
 *
 * test-workbench_change — hand written on purpose: the surface we need is four
 * JSON-RPC methods over one POST endpoint, so we avoid pulling the MCP SDK into
 * the agent host. Mirrors the extension-host bridge used for VS Code's browser
 * tools (`vscode-browser-tools/mcp-server.ts` in the testagent-kilo repo).
 *
 * Only POST is served; the MCP client treats a 405 on GET as "no standalone
 * stream", which is the correct answer for a stateless server.
 */
export class McpHttpServer {
	private _server: http.Server | undefined;
	private _endpoint: string | undefined;

	constructor(
		private readonly _provider: IMcpToolProvider,
		private readonly _info: { readonly name: string; readonly version: string },
		private readonly _path = '/mcp',
	) { }

	/** Endpoint to hand to the backend. Only valid between `start()` and `stop()`. */
	get url(): string | undefined {
		return this._endpoint;
	}

	async start(): Promise<string> {
		if (this._endpoint) {
			return this._endpoint;
		}

		// Lazy for startup cost (https://github.com/nodejs/node/issues/59686).
		const http = await import('http');
		const server = http.createServer((req, res) => {
			this._handle(req, res).catch(err => {
				console.error('[TestAgent] McpHttpServer: request failed', err);
				respond(res, 500, { error: 'internal error' });
			});
		});
		server.on('clientError', (_err, socket) => socket.destroy());

		await new Promise<void>((resolve, reject) => {
			const fail = (err: Error) => reject(err);
			server.once('error', fail);
			server.listen(0, '127.0.0.1', () => {
				server.off('error', fail);
				resolve();
			});
		});

		const port = (server.address() as AddressInfo).port;
		this._server = server;
		this._endpoint = `http://127.0.0.1:${port}${this._path}`;
		return this._endpoint;
	}

	async stop(): Promise<void> {
		const server = this._server;
		if (!server) {
			return;
		}
		this._server = undefined;
		this._endpoint = undefined;
		// Keep-alive sockets would otherwise hold `close()` open until they time out.
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
	}

	private async _handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const path = (req.url ?? '').split('?')[0];
		if (path !== this._path) {
			respond(res, 404, { error: 'not found' });
			return;
		}
		if (req.method !== 'POST') {
			respondEmpty(res, 405);
			return;
		}

		const body = await readBody(req);
		if (body === undefined) {
			respond(res, 400, { error: 'unreadable request body' });
			return;
		}

		let payload: unknown;
		try {
			payload = JSON.parse(body);
		} catch {
			respond(res, 200, rpcError(null, -32700, 'Parse error'));
			return;
		}

		// A payload is either one message or a batch of them.
		const batch = Array.isArray(payload) ? payload : undefined;
		const messages = batch ?? [payload];
		const controller = new AbortController();
		res.on('close', () => controller.abort());

		const replies: unknown[] = [];
		for (const message of messages) {
			const reply = await this._dispatch(message, controller.signal);
			if (reply !== undefined) {
				replies.push(reply);
			}
		}

		// A payload made up of notifications has nothing to answer.
		if (replies.length === 0) {
			respondEmpty(res, 202);
			return;
		}
		respond(res, 200, batch ? replies : replies[0]);
	}

	private async _dispatch(message: unknown, signal: AbortSignal): Promise<unknown | undefined> {
		if (!isRecord(message)) {
			return rpcError(null, -32600, 'Invalid Request');
		}
		const request = message as IJsonRpcRequest;
		const method = request.method;
		if (typeof method !== 'string') {
			return rpcError(null, -32600, 'Invalid Request');
		}
		// Notifications never get a JSON-RPC response, and none of them need handling.
		if (method.startsWith('notifications/')) {
			return undefined;
		}
		const isRequest = request.id !== undefined && request.id !== null;
		if (!isRequest) {
			return undefined;
		}

		try {
			return { jsonrpc: '2.0', id: request.id, result: await this._invoke(method, request.params, signal) };
		} catch (err) {
			if (err instanceof MethodError) {
				return rpcError(request.id, err.code, err.message);
			}
			console.error(`[TestAgent] McpHttpServer: ${method} failed`, err);
			return rpcError(request.id, -32603, err instanceof Error ? err.message : String(err));
		}
	}

	private async _invoke(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
		if (method === 'initialize') {
			const requested = readString(params, 'protocolVersion');
			return {
				protocolVersion: requested && SUPPORTED_VERSIONS.includes(requested) ? requested : FALLBACK_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: this._info.name, version: this._info.version },
			};
		}
		if (method === 'ping') {
			return {};
		}
		if (method === 'tools/list') {
			return { tools: this._provider.list().map(toWireTool) };
		}
		if (method === 'tools/call') {
			const name = readString(params, 'name');
			if (!name) {
				throw new MethodError(-32602, 'Invalid params: missing tool name');
			}
			try {
				const result = await this._provider.call(name, readObject(params, 'arguments'), signal);
				return result.isError ? { content: result.content, isError: true } : { content: result.content };
			} catch (err) {
				// Report tool failures in band so the model can react instead of losing the turn.
				return { content: [{ type: 'text', text: `Error: ${describe(err)}` }], isError: true };
			}
		}
		throw new MethodError(-32601, `Method not found: ${method}`);
	}
}

/**
 * MCP requires `type: "object"` at the schema root, so the shape is normalised
 * even though the server tools already describe themselves with JSON Schema.
 */
function toWireTool(spec: IMcpToolSpec): Record<string, unknown> {
	const schema = spec.inputSchema;
	return {
		name: spec.name,
		...(spec.description ? { description: spec.description } : {}),
		inputSchema: { ...schema, type: 'object', properties: readObject(schema, 'properties') },
	};
}

function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
	return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function respond(res: http.ServerResponse, status: number, body: unknown): void {
	if (res.headersSent || res.writableEnded) {
		return;
	}
	const text = JSON.stringify(body);
	res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
	res.end(text);
}

function respondEmpty(res: http.ServerResponse, status: number): void {
	if (res.headersSent || res.writableEnded) {
		return;
	}
	res.writeHead(status, { 'content-length': 0 });
	res.end();
}

function readBody(req: http.IncomingMessage): Promise<string | undefined> {
	return new Promise(resolve => {
		const chunks: Buffer[] = [];
		let size = 0;
		let tooLarge = false;
		req.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				tooLarge = true;
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(tooLarge ? undefined : Buffer.concat(chunks).toString('utf8')));
		req.on('error', () => resolve(undefined));
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const found = value[key];
	return typeof found === 'string' ? found : undefined;
}

function readObject(value: unknown, key: string): Record<string, unknown> {
	if (!isRecord(value)) {
		return {};
	}
	const found = value[key];
	return isRecord(found) ? found : {};
}

function describe(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value instanceof Error) {
		return value.message;
	}
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

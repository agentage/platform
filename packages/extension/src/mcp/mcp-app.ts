import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { fail } from '../envelope/envelope.js';
import { BODY_LIMIT, createPartApp, PUBLIC_CORS, type PartAppBase } from '../server/app.js';
import { serverFactory } from './server.js';
import { type ToolEntry } from './tools.js';

export interface McpAppOptions extends PartAppBase {
  tools: ToolEntry[];
  listing: 'open' | 'token';
}

const MCP_HEADERS = ['Mcp-Protocol-Version', 'Mcp-Method', 'Mcp-Name', 'Accept'];
const MCP_CORS = {
  ...PUBLIC_CORS,
  allowedHeaders: [...(PUBLIC_CORS.allowedHeaders as string[]), ...MCP_HEADERS],
};

const parsed = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
};

const isListing = (body: unknown): boolean =>
  (Array.isArray(body) ? body : [body]).some(
    (message) => (message as { method?: unknown } | null)?.method === 'tools/list'
  );

const webRequest = (req: Request, body: Buffer): globalThis.Request => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  return new globalThis.Request(`http://${req.get('host') ?? 'mcp'}/mcp`, {
    method: 'POST',
    headers,
    body,
  });
};

const send = async (response: globalThis.Response, res: Response): Promise<void> => {
  res.status(response.status);
  response.headers.forEach((value, key) => void res.setHeader(key, value));
  if (!response.body) return void res.end();
  await pipeline(Readable.fromWeb(response.body as never), res);
};

// The kit verifies no token yet, so a closed listing refuses every tools/list.
const handle =
  (handler: McpHttpHandler, listing: McpAppOptions['listing']) =>
  async (req: Request, res: Response): Promise<void> => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const message = parsed(body);
    if (listing === 'token' && isListing(message))
      throw fail('UNAUTHORIZED', 'tools/list needs a token');
    await send(await handler.fetch(webRequest(req, body), { parsedBody: message }), res);
  };

const methodNotAllowed = (_req: Request, res: Response): void => {
  res.setHeader('Allow', 'POST');
  res
    .status(405)
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
};

// Stateless Streamable HTTP on SDK v2: POST /mcp only, GET and DELETE (sessions) answer 405.
export const createMcpApp = (options: McpAppOptions): Express => {
  const identity = { id: options.pkg.agentage.id, version: options.pkg.version };
  const handler = createMcpHandler(serverFactory(identity, options.tools, options.log), {
    legacy: 'stateless',
    onerror: (err) => options.log.warn('mcp request refused', { reason: err.message }),
  });
  const raw = express.raw({ type: () => true, limit: BODY_LIMIT });
  return createPartApp({
    ...options,
    part: 'mcp',
    mount: (app) => {
      app.use('/mcp', cors(MCP_CORS));
      app.post('/mcp', raw, handle(handler, options.listing));
      app.all('/mcp', methodNotAllowed);
    },
  });
};

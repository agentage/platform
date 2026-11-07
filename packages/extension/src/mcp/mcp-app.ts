import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { strongest, type Access } from '../auth/token-check.js';
import { fail } from '../envelope/envelope.js';
import { BODY_LIMIT, createPartApp, PUBLIC_CORS, type PartAppBase } from '../server/app.js';
import { serverFactory } from './server.js';
import { prefixed, type ToolEntry } from './tools.js';

export interface McpAppOptions extends PartAppBase {
  tools: ToolEntry[];
  listing: 'open' | 'token';
}

const MCP_HEADERS = ['Mcp-Protocol-Version', 'Mcp-Method', 'Mcp-Name', 'Accept'];
const MCP_CORS = {
  ...PUBLIC_CORS,
  allowedHeaders: [...(PUBLIC_CORS.allowedHeaders as string[]), ...MCP_HEADERS],
};

const PARSE_ERROR = { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null };

const parsed = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
};

interface Message {
  method?: unknown;
  params?: { name?: unknown };
}

const messagesOf = (body: unknown): (Message | null)[] =>
  (Array.isArray(body) ? body : [body]) as (Message | null)[];

const isListing = (body: unknown): boolean =>
  messagesOf(body).some((message) => message?.method === 'tools/list');

// Each tools/call needs its tool's declared scope (read when it declares none).
const callAccess = (options: McpAppOptions, body: unknown): Access[] =>
  messagesOf(body)
    .filter((message) => message?.method === 'tools/call')
    .map((message) => {
      const id = options.pkg.agentage.id;
      const entry = options.tools.find((t) => prefixed(id, t.name) === message?.params?.name);
      return entry?.spec.scope ?? 'read';
    });

// Tokens off: calls stay anonymous and a closed listing refuses every tools/list (nothing can verify).
const guard = async (options: McpAppOptions, req: Request, body: unknown): Promise<boolean> => {
  const listing = options.listing === 'token' && isListing(body) ? (['read'] as Access[]) : [];
  const needed = [...listing, ...callAccess(options, body)];
  if (!options.tokenCheck) {
    if (listing.length > 0) throw fail('UNAUTHORIZED', 'tools/list needs a token');
    return false;
  }
  if (needed.length === 0) return false;
  return (await options.tokenCheck(req.get('authorization'), strongest(needed))) !== null;
};

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

const send = async (response: globalThis.Response, res: Response, auth: boolean) => {
  res.status(response.status);
  response.headers.forEach((value, key) => void res.setHeader(key, value));
  // After the SDK headers: its SSE answer sets no-cache, which a token-checked answer overrides.
  if (auth) res.setHeader('Cache-Control', 'no-store');
  if (!response.body) return void res.end();
  await pipeline(Readable.fromWeb(response.body as never), res);
};

const handle =
  (handler: McpHttpHandler, options: McpAppOptions) =>
  async (req: Request, res: Response): Promise<void> => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const message = parsed(body);
    // The SDK reads a body again when given none (a BOM, say): it must only run what guard read.
    if (message === undefined) return void res.status(400).json(PARSE_ERROR);
    const auth = await guard(options, req, message);
    await send(await handler.fetch(webRequest(req, body), { parsedBody: message }), res, auth);
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
      app.post('/mcp', raw, handle(handler, options));
      app.all('/mcp', methodNotAllowed);
    },
  });
};

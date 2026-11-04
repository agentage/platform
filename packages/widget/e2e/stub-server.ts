import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

// The ui part's policy (kit, behind helmet): the harness and the widget must run under it.
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' http://localhost:4281 http://127.0.0.1:4281; img-src 'self' data:";

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
};

export interface McpCall {
  headers: IncomingMessage['headers'];
  body: { id: number; method: string; params: { name: string; arguments: { msg?: string } } };
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

// Answers like createMcpHandler(factory, { legacy: 'stateless' }) does for 2026-07-28.
const answerMcp = async (req: IncomingMessage, res: ServerResponse, calls: McpCall[]) => {
  const body = JSON.parse(await readBody(req)) as McpCall['body'];
  calls.push({ headers: req.headers, body });
  const structuredContent = { msg: `pong ${body.params.arguments.msg ?? ''}` };
  const result = {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ result, jsonrpc: '2.0', id: body.id }));
};

const serveFile = async (root: string, url: string, res: ServerResponse) => {
  const rel = normalize(url.replace(/^\/ui\/[^/]+\//, '').split('?')[0] ?? '');
  const body = await readFile(join(root, rel)).catch(() => undefined);
  if (!body || rel.startsWith('..')) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream' });
  res.end(body);
};

export const startStub = (
  root: string,
  port: number
): Promise<{ server: Server; calls: McpCall[] }> => {
  const calls: McpCall[] = [];
  const server = createServer((req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'POST' && req.url === '/mcp') return void answerMcp(req, res, calls);
    if (req.method === 'GET' && req.url?.startsWith('/ui/'))
      return void serveFile(root, req.url, res);
    res.writeHead(404).end();
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done({ server, calls })));
};

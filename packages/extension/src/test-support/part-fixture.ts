import { type AddressInfo } from 'node:net';
import { runPart } from '../runtime/run-part.js';
import { linkModules } from './http.js';
import { AUDIENCE, ORIGIN, type TestIssuer } from './issuer.js';
import { DIGEST, json, SHA, tempPackage } from './packages.js';

// An api and mcp package like the probe, plus a write route, for the token check end to end.
const MANIFEST = {
  name: '@agentage/extension-probe',
  version: '0.3.0',
  engines: { agentage: '^0.3' },
  agentage: {
    id: 'probe',
    parts: { api: true, mcp: true },
    settings: { 'mcp.listing': { type: 'string', enum: ['open', 'token'], default: 'open' } },
  },
};
const OPENAPI = {
  openapi: '3.1.0',
  // Only operations declare scopes: a path-level key never adds this document-wide admin.
  security: [{ pat: ['probe:admin'] }],
  paths: {
    '/api/v1/echo': { parameters: [], get: { security: [{ pat: ['probe:read'] }] } },
    '/api/v1/ticks': { get: { security: [] } },
    '/api/v1/items': { post: { security: [{ pat: ['probe:write'] }] } },
    '/api/v1/items/{id}': { post: { security: [{ pat: ['probe:write'] }] } },
    '/api/v1/items/me': { post: { security: [{ pat: ['probe:read'] }] } },
  },
};
const image = (part: string) => ({ image: `ghcr.io/agentage/probe-${part}@${DIGEST}` });
const RECORD = {
  id: 'probe',
  version: '0.3.0',
  commit: SHA,
  buildTime: '2026-11-06T09:00:00Z',
  parts: { api: image('api'), mcp: image('mcp') },
  tools: [{ name: 'probe__echo', scope: 'probe:read' }],
};
const FILES = {
  'package.json': json(MANIFEST),
  'openapi.json': json(OPENAPI),
  'record.json': json(RECORD),
  'dist/api/index.js': `import { Router } from 'express';
export const create = (ctx) => {
  const router = Router();
  const caller = (req, res) => void res.json({ success: true, data: ctx.auth.caller(req) });
  router.get('/echo', caller);
  router.get('/ticks', caller);
  router.post('/items', caller);
  router.post('/items/:id', caller);
  router.post('/items/me', caller);
  return router;
};
`,
  'dist/mcp/index.js': `import { z } from 'zod';
export const create = (ctx) => {
  ctx.tool('echo', { description: 'Echo', scope: 'read', input: z.object({ msg: z.string().max(200) }),
    output: z.object({ msg: z.string() }) }, ({ msg }) => ({ msg: 'pong ' + msg }));
};
`,
};

export const STOP = 'SIGUSR2' as const;
export const RESOURCE = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;
export const INSUFFICIENT = 'Bearer error="insufficient_scope", scope="probe:read"';

export const partPackage = async (): Promise<string> => {
  const dir = await tempPackage(FILES);
  await linkModules(dir);
  return dir;
};

export const authEnv = (issuer: TestIssuer, dir: string) => ({
  PORT: '0',
  AGENTAGE_RECORD_FILE: `${dir}/record.json`,
  AGENTAGE_ISSUER: issuer.url,
  AGENTAGE_AUDIENCE: AUDIENCE,
  AGENTAGE_ORIGIN: ORIGIN,
});

// The part on 127.0.0.1; emitting STOP stops it.
export const startPart = async (dir: string, part: string, env: Record<string, unknown>) => {
  const serve = { signals: [STOP], exit: () => undefined };
  const server = await runPart({ dir, part, env: env as Record<string, string>, serve });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const MCP = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};

// POST /mcp with a raw body; the answer's JSON-RPC message, from JSON or the event stream.
export const postMcp = async (url: string, body: string, bearer?: string) => {
  const headers = { ...MCP, ...(bearer ? { authorization: bearer } : {}) };
  const res = await fetch(`${url}/mcp`, { method: 'POST', headers, body });
  const text = await res.text();
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  return {
    res,
    body: JSON.parse(data?.slice(5) ?? text) as Record<string, Record<string, unknown>>,
  };
};

export const rpc = (url: string, method: string, params: object, bearer?: string) =>
  postMcp(url, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), bearer);

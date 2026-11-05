import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPart } from '../runtime/run-part.js';
import { linkModules } from '../test-support/http.js';
import { AUDIENCE, ORIGIN, startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { DIGEST, json, SHA, tempPackage } from '../test-support/packages.js';
import { covers } from './part-auth.js';

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

const STOP = 'SIGUSR2' as const;
let dir: string;
let issuer: TestIssuer;
beforeAll(async () => {
  dir = await tempPackage(FILES);
  await linkModules(dir);
});
beforeEach(async () => {
  issuer = await startIssuer();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(async () => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
  await issuer.close();
});

const envOf = (extra: Record<string, string | undefined> = {}) => ({
  PORT: '0',
  AGENTAGE_RECORD_FILE: `${dir}/record.json`,
  AGENTAGE_ISSUER: issuer.url,
  AGENTAGE_AUDIENCE: AUDIENCE,
  AGENTAGE_ORIGIN: ORIGIN,
  ...extra,
});

const start = async (part: string, extra?: Record<string, string | undefined>) => {
  const server: Server = await runPart({
    dir,
    part,
    env: envOf(extra),
    serve: { signals: [STOP], exit: () => undefined },
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const MCP = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};
const rpc = async (url: string, method: string, params: object, bearer?: string) => {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { ...MCP, ...(bearer ? { authorization: bearer } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const data =
    text
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice(5) ?? text;
  return { res, body: JSON.parse(data) as Record<string, Record<string, unknown>> };
};
const RESOURCE = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;
const INSUFFICIENT = 'Bearer error="insufficient_scope", scope="probe:read"';

describe('the start rule', () => {
  it('covers: a wildcard is the domain at any depth, anything else one exact host', () => {
    for (const host of ['agentage.io', 'probe.agentage.io', 'probe.next.agentage.io'])
      expect(covers('*.agentage.io', host), host).toBe(true);
    for (const host of ['evilagentage.io', 'agentage.io.evil.com', 'localhost'])
      expect(covers('*.agentage.io', host), host).toBe(false);
    expect(covers('localhost', 'localhost')).toBe(true);
    expect(covers('localhost', 'probe.localhost')).toBe(false);
  });

  it('an api or mcp part without an issuer, or off its audience, does not start', async () => {
    for (const part of ['api', 'mcp']) {
      await expect(start(part, { AGENTAGE_ISSUER: undefined })).rejects.toThrow(/AGENTAGE_ISSUER/);
      await expect(start(part, { AGENTAGE_ORIGIN: 'https://probe.example.com' })).rejects.toThrow(
        'the host probe.example.com is not under the audience *.agentage.io'
      );
    }
  });
});

describe('an api part checks tokens (C5, C6)', () => {
  it('401 without a token, 403 naming the scope, 200 with the caller; public stays open', async () => {
    const url = await start('api');
    const none = await fetch(`${url}/api/v1/echo`, { headers: { agcid: 'trace-401-m3' } });
    expect([none.status, none.headers.get('www-authenticate')]).toEqual([401, RESOURCE]);
    expect(await none.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing token', agcid: 'trace-401-m3' },
    });
    const memory = await issuer.bearer({ scope: 'memory:read' });
    const refused = await fetch(`${url}/api/v1/echo`, { headers: { authorization: memory } });
    expect([refused.status, refused.headers.get('www-authenticate')]).toEqual([403, INSUFFICIENT]);
    expect(await refused.json()).toMatchObject({ error: { message: 'Needs probe:read' } });
    const read = await issuer.bearer({ scope: 'probe:read', sub: 'usr_1' });
    const echo = await fetch(`${url}/api/v1/echo`, { headers: { authorization: read } });
    expect(await echo.json()).toEqual({
      success: true,
      data: { sub: 'usr_1', scopes: ['probe:read'] },
    });
    expect(await (await fetch(`${url}/api/v1/ticks`)).json()).toEqual({
      success: true,
      data: null,
    });
  });

  it('serves the resource document and reports the auth check in /health', async () => {
    const url = await start('api');
    const doc = await fetch(`${url}/.well-known/oauth-protected-resource`);
    expect(doc.headers.get('access-control-allow-origin')).toBe('*');
    expect(await doc.json()).toEqual({
      resource: ORIGIN,
      authorization_servers: [issuer.url],
      scopes_supported: ['probe:read'],
      bearer_methods_supported: ['header'],
    });
    const health = (await (await fetch(`${url}/health`)).json()) as { data: { checks: object } };
    expect(health.data.checks).toEqual({ auth: 'ok' });
  });

  it('no key and the issuer down: 503 with Retry-After 5', async () => {
    const read = await issuer.bearer({ scope: 'probe:read' });
    await issuer.close();
    const url = await start('api');
    const res = await fetch(`${url}/api/v1/echo`, { headers: { authorization: read } });
    expect([res.status, res.headers.get('retry-after')]).toEqual([503, '5']);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
  });
});

describe('an mcp part checks tokens (C5, C7)', () => {
  it('initialize, ping and tools/list are anonymous; tools/call needs probe:read', async () => {
    const url = await start('mcp');
    const init = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't' } };
    for (const [method, params] of [
      ['initialize', init],
      ['ping', {}],
      ['tools/list', {}],
    ] as const)
      expect((await rpc(url, method, params)).res.status, method).toBe(200);
    const call = { name: 'probe__echo', arguments: { msg: 'hi' } };
    const none = await rpc(url, 'tools/call', call);
    expect([none.res.status, none.res.headers.get('www-authenticate')]).toEqual([401, RESOURCE]);
    const memory = await rpc(
      url,
      'tools/call',
      call,
      await issuer.bearer({ scope: 'memory:read' })
    );
    expect([memory.res.status, memory.res.headers.get('www-authenticate')]).toEqual([
      403,
      INSUFFICIENT,
    ]);
    const read = await issuer.bearer({ scope: 'probe:read' });
    expect((await rpc(url, 'tools/call', call, read)).body['result']).toMatchObject({
      structuredContent: { msg: 'pong hi' },
    });
  });

  it('a bad argument is a failed tool with the REST error shape', async () => {
    const url = await start('mcp');
    const read = await issuer.bearer({ scope: 'probe:read' });
    const bad = await rpc(url, 'tools/call', { name: 'probe__echo', arguments: { msg: 5 } }, read);
    expect(bad.res.status).toBe(200);
    expect(bad.body['result']).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Invalid arguments: msg' }],
      structuredContent: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid arguments: msg',
          agcid: expect.any(String),
        },
      },
    });
  });

  it('a closed listing (mcp.listing token) answers tools/list to probe:read only', async () => {
    const url = await start('mcp', { AGENTAGE_SETTINGS: '{"mcp.listing":"token"}' });
    expect((await rpc(url, 'tools/list', {})).res.status).toBe(401);
    const read = await issuer.bearer({ scope: 'probe:read' });
    const listed = await rpc(url, 'tools/list', {}, read);
    expect(listed.body['result']?.['tools']).toMatchObject([{ name: 'probe__echo' }]);
  });
});

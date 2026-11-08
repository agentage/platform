import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fail } from '../envelope/envelope.js';
import { createMcpApp } from '../mcp/mcp-app.js';
import { createToolRegistry } from '../mcp/tools.js';
import { createApiApp } from '../server/app.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { callerOf, type Access, type TokenCheck } from './token-check.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-05T10:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'probe', parts: { api: true, mcp: true } } };
const OPENAPI = {
  openapi: '3.1.0',
  paths: { '/api/v1/echo': { get: { security: [] } }, '/api/v1/body': { post: {} } },
};
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
  authorization: 'Bearer aga_x',
};

let served: Served | undefined;
afterEach(async () => served?.close());

// A check that records what it was asked and refuses with the given failure, if any.
const recorder = (refuse?: () => Error) => {
  const asked: [string | undefined, Access][] = [];
  const check: TokenCheck = async (authorization, access) => {
    asked.push([authorization, access]);
    if (refuse) throw refuse();
    return { sub: 'usr_1', scopes: ['probe:read'] };
  };
  return { asked, check };
};

const api = async (check?: TokenCheck) => {
  const router = Router();
  router.get('/echo', (req, res) => void res.json({ success: true, data: callerOf(req) }));
  router.post('/body', (_req, res) => void res.json({ success: true, data: 1 }));
  const log = recordedLog().log;
  const app = createApiApp({
    pkg: PKG,
    build: BUILD,
    log,
    router,
    openapi: OPENAPI,
    tokenCheck: check,
  });
  return (served = await serveApp(app));
};

const mcp = async (check?: TokenCheck, listing: 'open' | 'token' = 'open') => {
  const { tool, tools } = createToolRegistry();
  const spec = { input: z.object({}), output: z.object({}) };
  tool('echo', { description: 'Echo', ...spec }, () => ({}));
  tool('wipe', { description: 'Wipe', scope: 'admin', ...spec }, () => ({}));
  const log = recordedLog().log;
  const app = createMcpApp({ pkg: PKG, build: BUILD, log, tools, listing, tokenCheck: check });
  return (served = await serveApp(app));
};

const rpc = (s: Served, method: string, params: object = {}) =>
  fetch(`${s.url}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

describe('token check on api routes', () => {
  it('asks for the access the OpenAPI operation declares, before the body is read', async () => {
    const { asked, check } = recorder();
    const s = await api(check);
    const echo = await fetch(`${s.url}/api/v1/echo`, { headers: { authorization: 'Bearer t' } });
    expect(await echo.json()).toEqual({
      success: true,
      data: { sub: 'usr_1', scopes: ['probe:read'] },
    });
    await fetch(`${s.url}/api/v1/body`, { method: 'POST' });
    expect(asked).toEqual([
      ['Bearer t', 'public'],
      [undefined, 'read'],
    ]);
  });

  it('a refusal is its envelope: 401 even for a body that would not parse, 503 with Retry-After', async () => {
    const s = await api(recorder(() => fail('UNAUTHORIZED', 'No token')).check);
    const res = await fetch(`${s.url}/api/v1/body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', agcid: 'trace-401-check' },
      body: '{nope',
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'No token', agcid: 'trace-401-check' },
    });
    await served?.close();
    const down = await api(recorder(() => fail('UNAVAILABLE', 'JWKS unreachable')).check);
    const busy = await fetch(`${down.url}/api/v1/echo`, { headers: { agcid: 'trace-503-check' } });
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('30');
    expect(await busy.json()).toEqual({
      success: false,
      error: { code: 'UNAVAILABLE', message: 'JWKS unreachable', agcid: 'trace-503-check' },
    });
  });

  it('tokens off: no check runs and every route stays anonymous', async () => {
    const s = await api();
    const echo = await fetch(`${s.url}/api/v1/echo`);
    expect(await echo.json()).toEqual({ success: true, data: null });
    const body = await fetch(`${s.url}/api/v1/body`, { method: 'POST' });
    expect([body.status, await body.json()]).toEqual([200, { success: true, data: 1 }]);
  });
});

describe('token check on mcp tools', () => {
  it('each tools/call asks for its tool scope, read when it declares none', async () => {
    const { asked, check } = recorder();
    const s = await mcp(check);
    expect((await rpc(s, 'tools/call', { name: 'probe__wipe', arguments: {} })).status).toBe(200);
    await rpc(s, 'tools/call', { name: 'probe__echo', arguments: {} });
    await rpc(s, 'tools/list');
    expect(asked).toEqual([
      ['Bearer aga_x', 'admin'],
      ['Bearer aga_x', 'read'],
    ]);
  });

  it('a refused call is HTTP 403 or 503 with Retry-After, the envelope, never a tool result', async () => {
    const s = await mcp(recorder(() => fail('FORBIDDEN', 'insufficient_scope probe:admin')).check);
    const res = await rpc(s, 'tools/call', { name: 'probe__wipe', arguments: {} });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN', message: 'insufficient_scope probe:admin' },
    });
    await served?.close();
    const down = await mcp(recorder(() => fail('UNAVAILABLE', 'JWKS unreachable')).check);
    const busy = await rpc(down, 'tools/call', { name: 'probe__echo', arguments: {} });
    expect([busy.status, busy.headers.get('retry-after')]).toEqual([503, '30']);
    expect(await busy.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
  });

  it('a closed listing asks for read once tokens are on; off it refuses as before', async () => {
    const { asked, check } = recorder();
    const on = await mcp(check, 'token');
    expect((await rpc(on, 'tools/list')).status).toBe(200);
    expect(asked).toEqual([['Bearer aga_x', 'read']]);
    await served?.close();
    expect((await rpc(await mcp(undefined, 'token'), 'tools/list')).status).toBe(401);
  });

  it('refuses a tool that declares a scope the kit does not know', () => {
    const { tool } = createToolRegistry();
    const spec = { description: 'x', input: z.object({}), output: z.object({}) };
    expect(() => tool('odd', { ...spec, scope: 'root' as 'read' }, () => ({}))).toThrow(
      'tool odd scope root: one of public, read, write, admin'
    );
  });
});

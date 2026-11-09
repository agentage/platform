import { type ErrorRequestHandler } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { createMcpApp } from './mcp-app.js';
import { mcpSnapshot } from './snapshot.js';
import { createToolRegistry } from './tools.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-05T10:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'probe', parts: { mcp: true } } };
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const ECHO = {
  name: 'probe__echo',
  description: 'Echo',
  inputSchema: { $schema: SCHEMA, type: 'object', properties: {} },
  outputSchema: { $schema: SCHEMA, type: 'object', properties: {}, additionalProperties: false },
};

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const app = async (listing: 'open' | 'token') => {
  const { tool, tools } = createToolRegistry();
  tool('echo', { description: 'Echo', input: z.object({}), output: z.object({}) }, () => ({}));
  served = await serveApp(
    createMcpApp({ pkg: PKG, build: BUILD, log: recordedLog().log, tools, listing })
  );
  return served;
};

const post = (url: string, body: unknown, headers: Record<string, string> = HEADERS) =>
  fetch(`${url}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });

const MODERN = { ...HEADERS, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' };
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

describe('mcp listing', () => {
  it('with listing token, tools/list is refused with 401, alone or in a batch', async () => {
    const s = await app('token');
    const res = await post(s.url, LIST, { ...HEADERS, agcid: 'b1dd0194c682e07410904b0e4e9e811e' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'tools/list needs a token',
        agcid: 'b1dd0194c682e07410904b0e4e9e811e',
      },
    });
    expect((await post(s.url, [{ jsonrpc: '2.0', method: 'notifications/x' }, LIST])).status).toBe(
      401
    );
    await expect(mcpSnapshot(`${s.url}/mcp`, '2025-11-25')).rejects.toThrow(/mcp answered 401/);
  });

  it('still answers initialize, and refuses a body that is not JSON', async () => {
    const s = await app('token');
    const init = await post(s.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    });
    expect(init.status).toBe(200);
    const bad = await fetch(`${s.url}/mcp`, { method: 'POST', headers: HEADERS, body: '{nope' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 }, id: null });
  });
});

describe('mcp wire per protocol era', () => {
  it('answers a 2025-11-25 client with a one-event SSE stream, anonymous while listing is open', async () => {
    const res = await post((await app('open')).url, LIST);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const data = (await res.text()).split('\n').filter((line) => line.startsWith('data:'));
    expect(data).toHaveLength(1);
    const message = JSON.parse(data[0]?.slice(5) ?? '') as unknown;
    expect(message).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [ECHO] } });
  });

  it('answers a 2026-07-28 client with one JSON message carrying serverInfo', async () => {
    const res = await post((await app('open')).url, { ...LIST, params: { _meta: META } }, MODERN);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const message = (await res.json()) as { id: number; result: Record<string, unknown> };
    expect([message.id, message.result['tools']]).toEqual([1, [ECHO]]);
    expect(message.result['_meta']).toEqual({
      'io.modelcontextprotocol/serverInfo': { name: 'agentage-probe', version: '0.1.0' },
    });
  });

  it('refuses a 2026-07-28 tools/list without _meta, naming what is missing', async () => {
    const res = await post((await app('open')).url, LIST, MODERN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32602,
        message: expect.stringContaining('_meta'),
        data: { envelope: { missing: ['_meta'] } },
      },
    });
  });

  it('lets a browser client send the MCP headers cross-origin, without credentials', async () => {
    const res = await fetch(`${(await app('open')).url}/mcp`, {
      method: 'OPTIONS',
      headers: { origin: 'https://a.example', 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'Authorization,Content-Type,agcid,traceparent,If-Match,If-None-Match,Mcp-Protocol-Version,Mcp-Method,Mcp-Name,Accept'
    );
  });
});

describe('a client that closes early', () => {
  it('mid-answer: one warn line, no error line, no second answer on the started response', async () => {
    const { lines, log } = recordedLog();
    const { tool, tools } = createToolRegistry();
    const spec = {
      description: 'Big',
      input: z.object({}),
      output: z.object({ text: z.string() }),
    };
    tool('big', spec, () => ({ text: 'x'.repeat(2 ** 24) }));
    const thrown: unknown[] = [];
    const after: ErrorRequestHandler = (err, _req, _res, next) => (thrown.push(err), next());
    const mcp = createMcpApp({ pkg: PKG, build: BUILD, log, tools, listing: 'open' });
    served = await serveApp(mcp.use(after));
    const params = { name: 'probe__big', arguments: {} };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params });
    const abort = new AbortController();
    const init = { method: 'POST', headers: HEADERS, body, signal: abort.signal };
    await (await fetch(`${served.url}/mcp`, init)).body?.getReader().read();
    abort.abort();
    await vi.waitFor(() => expect(lines.map((l) => l['msg'])).toContain('client closed early'));
    expect([lines.filter((l) => l['level'] === 'error'), thrown]).toEqual([[], []]);
  });
});

describe('tool registry', () => {
  it('refuses a bad name, a second registration and a missing description', () => {
    const { tool, tools } = createToolRegistry();
    const spec = { description: 'Echo', input: z.object({}), output: z.object({}) };
    tool('echo_v2-x', spec, () => ({}));
    expect(() => tool('Echo', spec, () => ({}))).toThrow(
      'tool name Echo: lowercase, digits, _ and -'
    );
    expect(() => tool('2echo', spec, () => ({}))).toThrow(/tool name/);
    expect(() => tool('echo_v2-x', spec, () => ({}))).toThrow('tool echo_v2-x is registered twice');
    expect(() => tool('quiet', { ...spec, description: '' }, () => ({}))).toThrow(
      'tool quiet needs a description: it routes the model'
    );
    expect(tools.map((entry) => entry.name)).toEqual(['echo_v2-x']);
  });
});

describe('mcp cookies', () => {
  it('serves a request that carries a Cookie and answers with no Set-Cookie', async () => {
    const s = await app('open');
    const res = await post(s.url, LIST, { ...HEADERS, cookie: 'session=s3cr3t' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

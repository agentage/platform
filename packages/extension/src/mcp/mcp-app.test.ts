import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { createMcpApp } from './mcp-app.js';
import { canonical, mcpSnapshot } from './snapshot.js';
import { createToolRegistry } from './tools.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-05T10:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'probe', parts: { mcp: true } } };
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};

let served: Served | undefined;
let raw: Server | undefined;
afterEach(async () => {
  await served?.close();
  raw?.close();
  served = undefined;
  raw = undefined;
});

const tokenApp = async () => {
  const { tool, tools } = createToolRegistry();
  tool('echo', { description: 'Echo', input: z.object({}), output: z.object({}) }, () => ({}));
  served = await serveApp(
    createMcpApp({ pkg: PKG, build: BUILD, log: recordedLog().log, tools, listing: 'token' })
  );
  return served;
};

const post = (url: string, body: unknown) =>
  fetch(`${url}/mcp`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });

describe('mcp listing', () => {
  it('with listing token, tools/list is refused with 401, alone or in a batch', async () => {
    const s = await tokenApp();
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const res = await post(s.url, list);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    expect((await post(s.url, [{ jsonrpc: '2.0', method: 'notifications/x' }, list])).status).toBe(
      401
    );
    await expect(mcpSnapshot(`${s.url}/mcp`, '2025-11-25')).rejects.toThrow(/mcp answered 401/);
  });

  it('still answers initialize, and refuses a body that is not JSON', async () => {
    const s = await tokenApp();
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
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});

describe('mcp snapshot', () => {
  it('throws on a JSON-RPC error answer', async () => {
    raw = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no' } }));
    });
    await new Promise<void>((resolve) => raw?.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(raw.address() as AddressInfo).port}/mcp`;
    await expect(mcpSnapshot(url, '2026-07-28')).rejects.toThrow(/mcp error: .*-32601/);
  });

  it('sorts keys at every depth and keeps array order', () => {
    expect(JSON.stringify(canonical({ b: [{ z: 1, a: 2 }, 3], a: null }))).toBe(
      '{"a":null,"b":[{"a":2,"z":1},3]}'
    );
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

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { withJti } from '../auth/token-check.js';
import { fail } from '../envelope/envelope.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { createMcpApp } from './mcp-app.js';
import { createToolRegistry } from './tools.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-09T22:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'probe', parts: { mcp: true } } };
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
  authorization: 'Bearer t',
  'user-agent': 'claude-code/2.1.0 (cli)',
};
const empty = z.object({});

let served: Served | undefined;
afterEach(async () => served?.close());

const start = async () => {
  const { tool, tools } = createToolRegistry();
  const items = z.object({ items: z.array(z.number()) });
  tool('list', { description: 'List', input: empty, output: items }, () => ({ items: [1, 2, 3] }));
  tool('refuse', { description: 'Refuse', input: empty, output: empty }, () => {
    throw fail('NOT_FOUND', 'No such item');
  });
  tool('crash', { description: 'Crash', input: empty, output: empty }, () => {
    throw new RangeError('secret');
  });
  const recorded = recordedLog();
  const tokenCheck = async () => withJti({ sub: 'usr_7f3a', scopes: ['probe:read'] }, 'tok_1');
  const options = { pkg: PKG, build: BUILD, log: recorded.log, tools, tokenCheck };
  served = await serveApp(createMcpApp({ ...options, listing: 'open' }));
  const post = (method: string, params: object) =>
    fetch(`${served?.url}/mcp`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }).then((res) => res.text());
  return { post, lines: recorded.lines };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('mcp rows', () => {
  it('a tools/call is one mcp row with who and outcome, and no http row', async () => {
    const { post, lines } = await start();
    for (const name of ['list', 'refuse', 'crash'])
      await post('tools/call', { name: `probe__${name}`, arguments: {} });
    await settle();
    const rows = lines.filter((line) => line['kind'] === 'mcp');
    expect(lines.filter((line) => line['kind'] === 'http')).toEqual([]);
    expect(rows.map((r) => [r['gen_ai.tool.name'], r['level'], r['error.type']])).toEqual([
      ['probe__list', 'info', undefined],
      ['probe__refuse', 'info', undefined],
      ['probe__crash', 'error', 'RangeError'],
    ]);
    expect(rows[0]).toMatchObject({
      ...{ sub: 'usr_7f3a', session: 'tok_1', user_type: 'agent', client: 'claude-code' },
      'mcp.method.name': 'tools/call',
    });
    const errors = lines.filter((line) => line['kind'] === 'error');
    expect(errors.map((e) => [e['msg'], e['agentage.where']])).toEqual([
      ['RangeError: secret', 'probe__crash'],
    ]);
  });

  it('a tools/call to an unknown tool keeps its http row', async () => {
    const { post, lines } = await start();
    await post('tools/call', { name: 'probe__nope', arguments: {} });
    await settle();
    expect(lines.map((line) => [line['kind'], line['http.route']])).toEqual([['http', '/mcp']]);
  });

  it('initialize and tools/list leave an http row; initialize names the client', async () => {
    const { post, lines } = await start();
    const clientInfo = { name: 'claude-code', version: '2.1.0' };
    await post('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo });
    await post('tools/list', {});
    await settle();
    const rows = lines.filter((line) => line['kind'] === 'http');
    expect(rows.map((r) => [r['http.route'], r['agentage.client_info']])).toEqual([
      ['/mcp', 'claude-code'],
      ['/mcp', undefined],
    ]);
  });
});

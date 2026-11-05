import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { startTestMcp, type TestServer } from '../testing/test-server.js';
import { canonical, mcpSnapshot, PROTOCOL_VERSIONS } from './snapshot.js';
import { type McpContext } from './tools.js';

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';

// In canonical key order: the snapshot is committed and diffed as text, so key order is part of it.
const SNAPSHOT = {
  serverInfo: { name: 'agentage-probe', version: '0.2.0' },
  tools: [
    {
      description: 'Echo a message back',
      inputSchema: {
        $schema: SCHEMA,
        properties: { msg: { maxLength: 200, type: 'string' } },
        required: ['msg'],
        type: 'object',
      },
      name: 'probe__echo',
      outputSchema: {
        $schema: SCHEMA,
        additionalProperties: false,
        properties: { msg: { type: 'string' } },
        required: ['msg'],
        type: 'object',
      },
    },
    {
      description: 'Lists nothing',
      inputSchema: { $schema: SCHEMA, properties: {}, type: 'object' },
      name: 'probe__list',
      outputSchema: {
        $schema: SCHEMA,
        additionalProperties: false,
        properties: {},
        type: 'object',
      },
    },
  ],
};

const probe = (ctx: McpContext) => {
  const echo = {
    description: 'Echo a message back',
    input: z.object({ msg: z.string().max(200) }),
    output: z.object({ msg: z.string() }),
  };
  ctx.tool('echo', echo, ({ msg }) => ({ msg }));
  const list = { description: 'Lists nothing', input: z.object({}), output: z.object({}) };
  ctx.tool('list', list, () => ({}));
};

let server: TestServer | undefined;
let raw: Server | undefined;
afterEach(async () => {
  await server?.close();
  raw?.close();
  server = undefined;
  raw = undefined;
});

describe('mcp snapshot', () => {
  it('speaks the two protocol eras of the contract', () => {
    expect(PROTOCOL_VERSIONS).toEqual(['2025-11-25', '2026-07-28']);
  });

  it('is serverInfo and every whole tool entry, canonical, the same from both eras', async () => {
    const ctx = createTestContext({ extension: { id: 'probe', version: '0.2.0' } });
    server = await startTestMcp({ create: probe, ctx });
    for (const version of ['2025-11-25', '2026-07-28'] as const) {
      const snapshot = await mcpSnapshot(`${server.url}/mcp`, version);
      expect(JSON.stringify(snapshot), version).toBe(JSON.stringify(SNAPSHOT));
    }
  });

  it('throws on a JSON-RPC error answer', async () => {
    raw = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no' } }));
    });
    await new Promise<void>((resolve) => raw?.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(raw.address() as AddressInfo).port}/mcp`;
    await expect(mcpSnapshot(url, '2026-07-28')).rejects.toThrow(
      'mcp error: {"code":-32601,"message":"no"}'
    );
  });

  it('sorts keys at every depth and keeps array order', () => {
    expect(JSON.stringify(canonical({ b: [{ z: 1, a: 2 }, 3], a: null }))).toBe(
      '{"a":null,"b":[{"a":2,"z":1},3]}'
    );
  });
});

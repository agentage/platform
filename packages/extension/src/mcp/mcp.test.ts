import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { fail } from '../envelope/envelope.js';
import { startTestMcp, type TestServer } from '../testing/test-server.js';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serverFactory } from './server.js';
import { createToolRegistry } from './tools.js';
import { type McpContext } from './tools.js';

const probe = (ctx: McpContext) => {
  ctx.tool(
    'echo',
    {
      description: 'Echo a message back',
      input: z.object({ msg: z.string().max(200) }),
      output: z.object({ msg: z.string() }),
    },
    async ({ msg }) => ({ msg: `pong ${msg}` })
  );
  ctx.tool(
    'refuse',
    { description: 'Always refuses', input: z.object({}), output: z.object({}) },
    () => {
      throw fail('FORBIDDEN', 'not for you');
    }
  );
  ctx.tool(
    'crash',
    { description: 'Throws a plain error', input: z.object({}), output: z.object({}) },
    () => {
      throw new Error('secret detail');
    }
  );
};

let server: TestServer | undefined;
afterEach(async () => server?.close());

const start = async () => {
  const ctx = createTestContext({ extension: { id: 'probe', version: '0.2.0' } });
  server = await startTestMcp({ create: probe, ctx });
  return { server, ctx };
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};

const call = async (s: TestServer, name: string, args: object, agcid = 'trace-mcp-check') => {
  const res = await s.fetch('/mcp', {
    method: 'POST',
    headers: { ...HEADERS, agcid },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const data = text.includes('data:')
    ? text
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5)
    : text;
  return (JSON.parse(data ?? '{}') as { result: Record<string, unknown> }).result;
};

describe('mcp part', () => {
  it('answers tools/call with text and structured content', async () => {
    const { server: s } = await start();
    const result = await call(s, 'probe__echo', { msg: 'hi' });
    expect(result['structuredContent']).toEqual({ msg: 'pong hi' });
    expect(result['content']).toEqual([{ type: 'text', text: '{"msg":"pong hi"}' }]);
    expect(result['isError']).toBeUndefined();
  });

  it('a failing tool is isError with the REST error code; a crash is a generic INTERNAL', async () => {
    const { server: s, ctx } = await start();
    const refused = await call(s, 'probe__refuse', {});
    expect(refused['isError']).toBe(true);
    const error = { code: 'FORBIDDEN', message: 'not for you', agcid: 'trace-mcp-check' };
    expect(refused['structuredContent']).toEqual({ error });
    expect(refused['content']).toEqual([{ type: 'text', text: JSON.stringify({ error }) }]);
    const crashed = await call(s, 'probe__crash', {}, 'trace-crash-check');
    expect(crashed['structuredContent']).toEqual({
      error: { code: 'INTERNAL', message: 'Internal error', agcid: 'trace-crash-check' },
    });
    expect(JSON.stringify(crashed)).not.toContain('secret detail');
    expect(ctx.logs.find((entry) => entry.level === 'error')?.message).toBe('secret detail');
  });

  it('answers 405 to GET, DELETE and any other method on /mcp', async () => {
    const { server: s } = await start();
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const res = await s.fetch('/mcp', { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(await res.json()).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
    }
  });

  it('a tool error outside any request scope still carries a valid agcid', async () => {
    const ctx = createTestContext({ extension: { id: 'probe', version: '0.2.0' } });
    const registry = createToolRegistry();
    probe({ ...ctx, tool: registry.tool });
    const handler = createMcpHandler(
      serverFactory({ id: 'probe', version: '0.2.0' }, registry.tools, ctx.log),
      { legacy: 'stateless' }
    );
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'probe__refuse', arguments: {} },
    };
    const res = await handler.fetch(
      new Request('http://mcp/mcp', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      }),
      { parsedBody: body }
    );
    const text = await res.text();
    const data =
      text
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5) ?? text;
    const result = (JSON.parse(data) as { result: { structuredContent: { error: object } } })
      .result;
    const { agcid } = result.structuredContent.error as { agcid: string };
    expect(agcid).toMatch(UUID_V7);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { fail } from '../envelope/envelope.js';
import { startTestMcp, type TestServer } from '../testing/test-server.js';
import { mcpSnapshot } from './snapshot.js';
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

const call = async (s: TestServer, name: string, args: object) => {
  const res = await s.fetch('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
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
  it('gives clients of both protocol versions the same canonical snapshot', async () => {
    const { server: s } = await start();
    const old = await mcpSnapshot(`${s.url}/mcp`, '2025-11-25');
    const modern = await mcpSnapshot(`${s.url}/mcp`, '2026-07-28');
    expect(modern).toEqual(old);
    expect(old.serverInfo).toEqual({ name: 'agentage-probe', version: '0.2.0' });
    expect(old.tools.map((tool) => tool['name'])).toEqual([
      'probe__echo',
      'probe__refuse',
      'probe__crash',
    ]);
    expect(old.tools[0]).toMatchObject({
      description: 'Echo a message back',
      inputSchema: { type: 'object', properties: { msg: { type: 'string', maxLength: 200 } } },
      outputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
    });
    expect(JSON.stringify(old)).toBe(JSON.stringify(modern));
  });

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
    expect(refused['structuredContent']).toMatchObject({
      error: {
        code: 'FORBIDDEN',
        message: 'not for you',
        agcid: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    const crashed = await call(s, 'probe__crash', {});
    expect(crashed['structuredContent']).toMatchObject({
      error: { code: 'INTERNAL', message: 'Internal error' },
    });
    expect(JSON.stringify(crashed)).not.toContain('secret detail');
    expect(ctx.logs.find((entry) => entry.level === 'error')?.message).toBe('secret detail');
  });

  it('answers 405 to GET and DELETE on /mcp', async () => {
    const { server: s } = await start();
    for (const method of ['GET', 'DELETE']) {
      const res = await s.fetch('/mcp', { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } });
    }
  });
});

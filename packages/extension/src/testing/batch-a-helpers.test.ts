import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContext } from '../context/context.js';
import { createTestContext } from '../context/test-context.js';
import { validateManifest } from '../manifest/read-manifest.js';
import { type McpContext } from '../mcp/tools.js';
import { API_MANIFEST, SPEC_MANIFEST } from '../test-support/packages.js';
import { startTestMcp, type TestMcp } from './test-server.js';

const echo = (ctx: McpContext) => {
  const msg = z.object({ msg: z.string() });
  ctx.tool('echo', { description: 'Echo', input: msg, output: msg }, ({ msg }) => ({
    msg: `pong ${msg}`,
  }));
  ctx.tool('refuse', { description: 'Refuses', input: z.object({}), output: msg }, () => {
    throw new Error('no');
  });
};

let server: TestMcp | undefined;
afterEach(async () => server?.close());

describe('ctx.extension.store', () => {
  const at = { part: 'api' as const, origin: 'http://127.0.0.1', commit: '0'.repeat(40) };

  it('is the declared kind, absent without a store', () => {
    expect(createContext({ ...at, pkg: validateManifest(SPEC_MANIFEST) }).extension.store).toBe(
      'postgres'
    );
    expect(createContext({ ...at, pkg: API_MANIFEST }).extension).not.toHaveProperty('store');
  });

  it('follows the test option, or a test store, in createTestContext', () => {
    expect(createTestContext().extension.store).toBeUndefined();
    expect(createTestContext({ extension: { store: 'git' } }).extension.store).toBe('git');
    expect(createTestContext({ store: { dir: '/none' } }).extension.store).toBe('postgres');
  });
});

describe('startTestMcp().call', () => {
  it('calls a tool by its own name and gives the structured result', async () => {
    server = await startTestMcp({ create: echo });
    expect(await server.call('echo', { msg: 'hi' })).toEqual({ msg: 'pong hi' });
  });

  it('throws on a tool error', async () => {
    server = await startTestMcp({ create: echo });
    await expect(server.call('refuse')).rejects.toThrow(/^tool test__refuse: /);
  });
});

describe('ctx.jobs', () => {
  it('records each scheduled job: name, cron and options', () => {
    const ctx = createTestContext();
    ctx.schedule('tick', '* * * * *', () => undefined, { timeout: '30s' });
    ctx.schedule('daily', '7 4 * * *', () => undefined);
    expect(ctx.jobs).toEqual([
      { name: 'tick', cron: '* * * * *', options: { timeout: '30s' } },
      { name: 'daily', cron: '7 4 * * *' },
    ]);
  });

  it('records nothing the scheduler refuses', () => {
    const ctx = createTestContext();
    expect(() => ctx.schedule('tick', 'nope', () => undefined)).toThrow();
    expect(ctx.jobs).toEqual([]);
  });
});

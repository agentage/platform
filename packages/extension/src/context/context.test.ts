import { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest/read-manifest.js';
import { SPEC_MANIFEST } from '../test-support/packages.js';
import { startTestServer } from '../testing/test-server.js';
import { createContext, settingDefaults } from './context.js';
import { createTestContext } from './test-context.js';

describe('ctx', () => {
  it('carries identity and the declared settings with defaults filled, frozen', () => {
    const pkg = validateManifest(SPEC_MANIFEST);
    const ctx = createContext({
      pkg,
      part: 'api',
      origin: 'https://probe.next.agentage.io',
      commit: 'a'.repeat(40),
    });
    expect(ctx.extension).toEqual({
      id: 'probe',
      version: '0.1.0',
      part: 'api',
      origin: 'https://probe.next.agentage.io',
      commit: 'a'.repeat(40),
    });
    expect(ctx.settings).toEqual({ 'mcp.listing': 'open' });
    expect(Object.isFrozen(ctx.settings)).toBe(true);
    expect(settingDefaults({ ...pkg, agentage: { ...pkg.agentage, settings: undefined } })).toEqual(
      {}
    );
  });

  it('createTestContext records logs instead of printing', () => {
    const ctx = createTestContext({ extension: { id: 'probe' }, settings: { a: 1 } });
    ctx.log.info('hello', { n: 1 });
    ctx.log.warn('careful');
    ctx.log.error(new Error('boom'));
    expect(ctx.extension.id).toBe('probe');
    expect(ctx.settings).toEqual({ a: 1 });
    expect(ctx.logs.map((entry) => [entry.level, entry.message])).toEqual([
      ['info', 'hello'],
      ['warn', 'careful'],
      ['error', 'boom'],
    ]);
  });

  it('startTestServer runs a part inside the kit app', async () => {
    const server = await startTestServer({
      create: (ctx) => {
        const router = Router();
        router.get('/who', (_req, res) => void res.json({ success: true, data: ctx.extension.id }));
        return router;
      },
      ctx: createTestContext({ extension: { id: 'probe' } }),
    });
    const res = await server.fetch('/api/v1/who');
    expect(await res.json()).toEqual({ success: true, data: 'probe' });
    expect((await server.fetch('/health')).status).toBe(200);
    await server.close();
  });

  it('startTestServer defaults to a test ctx', async () => {
    const server = await startTestServer({ create: () => Router() });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await server.fetch('/api/v1/x')).status).toBe(404);
    await server.close();
  });
});

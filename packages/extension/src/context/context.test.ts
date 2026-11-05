import { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest/read-manifest.js';
import { API_MANIFEST, SHA, SPEC_MANIFEST } from '../test-support/packages.js';
import { recordedLog } from '../test-support/http.js';
import { startTestServer } from '../testing/test-server.js';
import { setCaller } from '../auth/token-check.js';
import { createContext, settingDefaults } from './context.js';
import { createTestContext } from './test-context.js';

const BASE = {
  pkg: validateManifest(SPEC_MANIFEST),
  part: 'api' as const,
  origin: 'http://127.0.0.1',
  commit: SHA,
};

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
    expect([ctx, ctx.extension, ctx.settings].every((part) => Object.isFrozen(part))).toBe(true);
    expect(settingDefaults({ ...pkg, agentage: { ...pkg.agentage, settings: undefined } })).toEqual(
      {}
    );
  });

  it('takes the host settings over the defaults, and the given log and store', () => {
    const { log } = recordedLog();
    const store = { query: async () => ({ rows: [] }) };
    const settings = { 'mcp.listing': 'token' };
    const ctx = createContext({ ...BASE, part: 'worker', log, store, settings });
    expect(ctx.settings).toEqual({ 'mcp.listing': 'token' });
    expect(ctx.log).toBe(log);
    expect(ctx.store).toBe(store);
  });

  it('always has ctx.store; without a store part it throws on first use', async () => {
    const ctx = createContext({ ...BASE, pkg: validateManifest(API_MANIFEST) });
    await expect(ctx.store.query('select 1')).rejects.toThrow(
      new Error('this extension declares no store: add parts.store to the manifest')
    );
  });

  it('createTestContext records logs instead of printing', () => {
    const ctx = createTestContext({ extension: { id: 'probe' }, settings: { a: 1 } });
    const boom = new Error('boom');
    ctx.log.info('hello', { n: 1 });
    ctx.log.warn('careful');
    ctx.log.error(boom, { job: 'tick' });
    expect(ctx.extension.id).toBe('probe');
    expect(ctx.settings).toEqual({ a: 1 });
    expect(ctx.logs).toEqual([
      { level: 'info', message: 'hello', fields: { n: 1 } },
      { level: 'warn', message: 'careful', fields: {} },
      { level: 'error', message: 'boom', fields: { job: 'tick', err: boom } },
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
    const server = await startTestServer({
      create: (ctx) => Router().get('/who', (_req, res) => void res.json(ctx.extension)),
    });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await (await server.fetch('/api/v1/who')).json()).toEqual({
      id: 'test',
      version: '0.0.0',
      part: 'api',
      origin: 'http://127.0.0.1',
      commit: '0'.repeat(40),
    });
    await server.close();
  });
});

describe('ctx.auth (C6)', () => {
  it('caller(request) is what the kit checked for that request, null when anonymous', () => {
    const ctx = createContext(BASE);
    const request = {};
    expect(ctx.auth.caller(request)).toBeNull();
    setCaller(request, { sub: 'usr_1', scopes: ['probe:read'] });
    expect(ctx.auth.caller(request)).toEqual({ sub: 'usr_1', scopes: ['probe:read'] });
  });

  it('the test context has a fixed caller with read on its own extension', () => {
    const ctx = createTestContext({ extension: { id: 'probe' } });
    expect(ctx.auth.caller({})).toEqual({ sub: 'usr_test', scopes: ['probe:read'] });
  });
});

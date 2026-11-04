import { type AddressInfo } from 'node:net';
import { type Server } from 'node:http';
import { Router, type Request, type Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context/context.js';
import { DiscoveryDocumentSchema } from '../discovery/discovery.schema.js';
import { fail } from '../envelope/envelope.js';
import { ErrorEnvelopeSchema } from '../envelope/envelope.schema.js';
import { createHealthHandler } from '../health/health.js';
import { HealthSchema } from '../health/health.schema.js';
import { createLog } from '../log/log.js';
import { API_MANIFEST, DIGEST, SHA } from '../test-support/packages.js';
import { createApiApp, type ApiAppOptions } from './app.js';
import { listen } from './serve.js';

const BUILD = { commit: SHA, buildTime: '2026-11-03T20:00:00Z' };
const JSON_TYPE = { 'content-type': 'application/json' };
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const routes = (): Router => {
  const router = Router();
  router.get(
    '/echo',
    (req, res) => void res.json({ success: true, data: { msg: req.query['msg'] } })
  );
  router.post('/body', (req, res) => void res.json({ success: true, data: req.body as unknown }));
  router.get('/boom', () => {
    throw new Error('secret driver message');
  });
  router.get('/busy', () => {
    throw fail('UNAVAILABLE', 'Try later');
  });
  return router;
};

let server: Server | undefined;
afterEach(() => server?.close());

const start = async (extra: Partial<ApiAppOptions> = {}) => {
  const ctx = createTestContext();
  const app = createApiApp({
    pkg: API_MANIFEST,
    build: BUILD,
    router: routes(),
    log: ctx.log,
    ...extra,
  });
  server = await listen(app, 0, '127.0.0.1');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ctx, get: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init) };
};

describe('api app: kit routes', () => {
  it('serves /health on loopback, no-store, with the build commit', async () => {
    const { get } = await start();
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { data: { commit: string; part: string } };
    expect(HealthSchema.safeParse(body).success).toBe(true);
    expect(body.data).toMatchObject({ commit: SHA, part: 'api', extension: 'probe' });
  });

  it('refuses /health off loopback with a 404', async () => {
    const handler = createHealthHandler({
      extension: 'probe',
      part: 'api',
      version: '0.1.0',
      build: BUILD,
    });
    const req = { socket: { localAddress: '10.0.1.7' } } as unknown as Request;
    await expect(handler(req, {} as Response, () => undefined)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('serves discovery with images by tag when no record is mounted', async () => {
    const { get } = await start({ ownImage: 'ghcr.io/agentage/probe-api:0.1.0' });
    const res = await get('/.well-known/agentage-extension.json', {
      headers: { origin: 'https://x.io' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc).toMatchObject({ id: 'probe', version: '0.1.0', commit: SHA });
    expect(doc['host']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(doc['parts']).toEqual({ api: { image: 'ghcr.io/agentage/probe-api:0.1.0' } });
  });

  it('serves the mounted record by digest, on the configured origin', async () => {
    const image = `ghcr.io/agentage/probe-api@${DIGEST}`;
    const record = { id: 'probe', version: '0.1.0', ...BUILD, parts: { api: { image } } };
    const { get } = await start({ record, origin: 'https://probe.next.agentage.io' });
    const doc = await (await get('/.well-known/agentage-extension.json')).json();
    expect(DiscoveryDocumentSchema.parse(doc)).toMatchObject({
      host: 'https://probe.next.agentage.io',
      parts: { api: { image } },
    });
  });
});

describe('api app: envelope and headers', () => {
  it('mounts the part under /api/v1 and mints an agcid', async () => {
    const { get } = await start();
    const res = await get('/api/v1/echo?msg=hi');
    expect(await res.json()).toEqual({ success: true, data: { msg: 'hi' } });
    expect(res.headers.get('agcid')).toMatch(UUID_V7);
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sends an agcid on every response, kit routes and misses included', async () => {
    const { get } = await start();
    const paths = ['/health', '/.well-known/agentage-extension.json', '/api/v1/echo', '/x'];
    for (const path of paths) expect((await get(path)).headers.get('agcid'), path).toMatch(UUID_V7);
  });

  it('keeps a valid incoming agcid and replaces an invalid one', async () => {
    const { get } = await start();
    const kept = await get('/api/v1/echo', { headers: { agcid: 'caller-chosen-id' } });
    expect(kept.headers.get('agcid')).toBe('caller-chosen-id');
    const replaced = await get('/api/v1/echo', { headers: { agcid: 'bad id' } });
    expect(replaced.headers.get('agcid')).toMatch(UUID_V7);
  });

  it('answers a miss with a 404 envelope carrying the agcid', async () => {
    const { get } = await start();
    for (const path of ['/api/v1/nope', '/api/', '/mcp/x', '/']) {
      const res = await get(path, { headers: { agcid: 'trace-404-check' } });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({ error: { code: 'NOT_FOUND', agcid: 'trace-404-check' } });
    }
  });

  it('hides internals behind INTERNAL 500 and logs the error whole, tagged with the agcid', async () => {
    const lines: Record<string, unknown>[] = [];
    const log = createLog({ extension: 'probe', part: 'api' }, (line) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    });
    const { get } = await start({ log });
    const res = await get('/api/v1/boom', { headers: { agcid: 'trace-500-check' } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret driver message');
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'INTERNAL', message: 'Internal error', agcid: 'trace-500-check' },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      msg: 'secret driver message',
      agcid: 'trace-500-check',
      err: { type: 'Error', message: 'secret driver message' },
    });
  });

  it('logs a 5xx only; a 4xx is the caller, not the part', async () => {
    const { get, ctx } = await start();
    await get('/api/v1/nope');
    await get('/api/v1/body', { method: 'POST', body: '{bad', headers: JSON_TYPE });
    expect(ctx.logs).toEqual([]);
    await get('/api/v1/busy');
    expect(ctx.logs.map((entry) => entry.message)).toEqual(['Try later']);
  });

  it('sends Retry-After with 503', async () => {
    const { get } = await start();
    const res = await get('/api/v1/busy');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('maps a bad JSON body to 400 and an oversized one to 413', async () => {
    const { get } = await start();
    const post = (body: string) =>
      get('/api/v1/body', {
        method: 'POST',
        body,
        headers: JSON_TYPE,
      });
    expect((await post('{"a":1}')).status).toBe(200);
    expect(await (await post('{bad')).json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    const big = await post(JSON.stringify({ a: 'x'.repeat(1_100_000) }));
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('answers a CORS preflight on /api/ without credentials', async () => {
    const { get } = await start();
    const res = await get('/api/v1/echo', {
      method: 'OPTIONS',
      headers: { origin: 'https://a.example', 'access-control-request-method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('access-control-allow-headers')).toContain('agcid');
  });
});

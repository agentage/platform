import { type AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { listen } from '../server/serve.js';
import contractExample from '../test-support/fixtures/health-memory.json' with { type: 'json' };
import withHostname from '../test-support/fixtures/neg-health-hostname.json' with { type: 'json' };
import {
  CHECK_TIMEOUT_MS,
  createHealthHandler,
  healthBody,
  isLoopback,
  worstOf,
  type ResolvedHealth,
} from './health.js';
import { HealthSchema, type HealthStatus } from './health.schema.js';

const OPTIONS: ResolvedHealth = {
  extension: 'probe',
  part: 'api',
  version: '0.1.0',
  build: { commit: 'a'.repeat(40), buildTime: '2026-11-03T20:00:00Z' },
  instance: 'b82fc8d3',
  startedAt: Date.UTC(2026, 10, 3, 20, 0, 0),
  now: () => new Date(Date.UTC(2026, 10, 3, 20, 9, 50, 500)),
};

describe('health', () => {
  it('answers the api-standards shape', async () => {
    const body = await healthBody(OPTIONS);
    expect(body).toEqual({
      success: true,
      data: {
        status: 'ok',
        extension: 'probe',
        part: 'api',
        version: '0.1.0',
        commit: 'a'.repeat(40),
        buildTime: '2026-11-03T20:00:00Z',
        instance: 'b82fc8d3',
        uptimeSeconds: 590,
        checkedAt: '2026-11-03T20:09:50Z',
        checks: {},
      },
    });
    expect(HealthSchema.safeParse(body).success).toBe(true);
  });

  it('takes the worst check; a throwing check is unavailable', async () => {
    const checks = { store: async () => 'degraded' as const, auth: async () => 'ok' as const };
    const degraded = await healthBody({ ...OPTIONS, checks });
    const statuses = { store: 'degraded', auth: 'ok' };
    expect(degraded).toMatchObject({
      success: true,
      data: { status: 'degraded', checks: statuses },
    });
    const down = { store: () => Promise.reject(new Error('down')) };
    const body = await healthBody({ ...OPTIONS, checks: down });
    expect(body).toMatchObject({ success: false, data: { status: 'unavailable' } });
    expect(body.data.checks).toEqual({ store: 'unavailable' });
    expect(worstOf([])).toBe('ok');
    const odd = {
      thrown: () => {
        throw new Error('sync');
      },
      up: async () => 'up' as never,
    };
    const refused = await healthBody({ ...OPTIONS, checks: odd });
    expect(refused.data.checks).toEqual({ thrown: 'unavailable', up: 'unavailable' });
  });

  it('a check still pending after CHECK_TIMEOUT_MS reads unavailable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const hung = () => new Promise<HealthStatus>(() => undefined);
      const pending = healthBody({ ...OPTIONS, checks: { store: hung, auth: async () => 'ok' } });
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      expect((await pending).data.checks).toEqual({ store: 'unavailable', auth: 'ok' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the handler answers 503, no-store, with data, when the worst check is unavailable', async () => {
    const app = express();
    const checks = { store: async (): Promise<HealthStatus> => 'unavailable' };
    app.get('/health', createHealthHandler({ ...OPTIONS, checks }));
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = HealthSchema.parse(await res.json());
      expect(body).toMatchObject({ success: false, data: { status: 'unavailable', part: 'api' } });
    } finally {
      server.close();
    }
  });

  it('the handler refuses a socket off loopback with NOT_FOUND, running no check', async () => {
    const store = vi.fn(async (): Promise<HealthStatus> => 'ok');
    const handler = createHealthHandler({ ...OPTIONS, checks: { store } });
    const req = { socket: { localAddress: '10.0.1.7' } } as unknown as Request;
    await expect(handler(req, {} as Response, () => undefined)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Not found',
    });
    expect(store).not.toHaveBeenCalled();
  });

  it('the schema takes the contract example and refuses a hostname', () => {
    expect(HealthSchema.safeParse(contractExample).success).toBe(true);
    expect(HealthSchema.safeParse(withHostname).success).toBe(false);
  });

  it('knows loopback in every form a socket reports it', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.53']) {
      expect(isLoopback(address)).toBe(true);
    }
    for (const address of ['10.0.1.7', '::ffff:10.0.1.7', '172.17.0.2', undefined]) {
      expect(isLoopback(address)).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import contractExample from '../test-support/fixtures/health-memory.json' with { type: 'json' };
import withHostname from '../test-support/fixtures/neg-health-hostname.json' with { type: 'json' };
import { healthBody, isLoopback, worstOf, type HealthOptions } from './health.js';
import { HealthSchema } from './health.schema.js';

const OPTIONS: HealthOptions = {
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
    expect((await healthBody({ ...OPTIONS, checks })).data.status).toBe('degraded');
    const down = { store: () => Promise.reject(new Error('down')) };
    const body = await healthBody({ ...OPTIONS, checks: down });
    expect(body).toMatchObject({ success: false, data: { status: 'unavailable' } });
    expect(body.data.checks).toEqual({ store: 'unavailable' });
    expect(worstOf([])).toBe('ok');
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

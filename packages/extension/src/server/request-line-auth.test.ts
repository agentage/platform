import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { fail } from '../envelope/envelope.js';
import { createHealthHandler } from '../health/health.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, SHA } from '../test-support/packages.js';
import { createApiApp } from './app.js';

const BUILD = { commit: SHA, buildTime: '2026-11-09T22:00:00Z' };
let served: Served | undefined;
afterEach(() => served?.close());

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('http row on a refusal', () => {
  it('a refused known route keeps its template and says why; a miss is (unmatched)', async () => {
    const recorded = recordedLog();
    const tokenCheck = async (authorization: string | undefined) => {
      throw authorization ? fail('FORBIDDEN', 'needs write') : fail('UNAUTHORIZED', 'No token');
    };
    const router = Router().get('/machines/:id', (_req, res) => void res.json({}));
    const routes = [{ method: 'get', path: '/machines/{id}' }];
    const options = { pkg: API_MANIFEST, build: BUILD, log: recorded.log, router, routes };
    served = await serveApp(createApiApp({ ...options, tokenCheck }));
    await fetch(`${served.url}/api/v1/machines/42`);
    await fetch(`${served.url}/api/v1/machines/42`, { headers: { authorization: 'Bearer x' } });
    await fetch(`${served.url}/api/v1/elsewhere`);
    await settle();
    const rows = recorded.lines.filter((line) => line['kind'] === 'http');
    expect(rows.map((r) => [r['http.route'], r['http.response.status_code']])).toEqual([
      ['/api/v1/machines/{id}', 401],
      ['/api/v1/machines/{id}', 403],
      ['(unmatched)', 404],
    ]);
    expect(rows.map((r) => r['agentage.auth.reason'])).toEqual([
      'missing_token',
      'insufficient_scope',
      undefined,
    ]);
  });

  it('health writes a health.changed event on a transition only', async () => {
    const recorded = recordedLog();
    let status: 'ok' | 'degraded' = 'ok';
    const handler = createHealthHandler({
      ...{ extension: 'probe', part: 'api', version: '0.1.0', build: BUILD },
      ...{ checks: { store: async () => status }, log: recorded.log },
    });
    const req = { socket: { localAddress: '127.0.0.1' } };
    const res = { setHeader: () => undefined, status: () => ({ json: () => undefined }) };
    const probe = () => handler(req as never, res as never, () => undefined);
    await probe();
    await probe();
    status = 'degraded';
    await probe();
    await probe();
    expect(recorded.lines).toMatchObject([
      { kind: 'event', 'event.name': 'health.changed', 'agentage.health.to': 'degraded' },
    ]);
  });
});

import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { fail } from '../envelope/envelope.js';
import { API_MANIFEST, SHA } from '../test-support/packages.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { createApiApp } from './app.js';

const routes = (): Router => {
  const router = Router();
  router.get('/items/:id', (req, res) => void res.json({ success: true, data: req.params }));
  router.get('/missing/:id', () => {
    throw fail('NOT_FOUND', 'No such item');
  });
  router.get('/boom', () => {
    throw new Error('driver down');
  });
  return router;
};

let served: Served | undefined;
afterEach(() => served?.close());

const start = async () => {
  const recorded = recordedLog();
  const app = createApiApp({
    pkg: API_MANIFEST,
    build: { commit: SHA, buildTime: '2026-11-08T00:00:00Z' },
    router: routes(),
    log: recorded.log,
  });
  served = await serveApp(app);
  const { url } = served;
  const get = (path: string) => fetch(`${url}${path}`, { headers: { agcid: 'trace-line-check' } });
  const requests = () => recorded.lines.filter((line) => line['msg'] === 'request');
  return { get, requests, lines: recorded.lines };
};

// finish fires after the client has the answer: wait for the line.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('request line', () => {
  it('writes one line per request at a level by status class, with the route template', async () => {
    const { get, requests } = await start();
    await get('/api/v1/items/usr_42?token=secret-query');
    await get('/api/v1/missing/7');
    await get('/api/v1/boom');
    await get('/api/v1/users/9/nope');
    await settle();
    const fields = requests().map(({ level, route, status, method }) => ({
      ...{ level, route, status, method },
    }));
    expect(fields).toEqual([
      { level: 'info', route: '/api/v1/items/:id', status: 200, method: 'GET' },
      { level: 'warn', route: '/api/v1/missing/:id', status: 404, method: 'GET' },
      { level: 'error', route: '/api/v1/boom', status: 500, method: 'GET' },
      { level: 'warn', route: '/api/v1', status: 404, method: 'GET' },
    ]);
    expect(requests()[0]).toMatchObject({ agcid: 'trace-line-check', 'extension.id': 'probe' });
    expect(typeof requests()[0]?.['ms']).toBe('number');
  });

  it('never logs the raw URL, a query string or an id, and carries no err', async () => {
    const { get, requests, lines } = await start();
    await get('/api/v1/items/usr_42?token=secret-query');
    await get('/api/v1/boom');
    await settle();
    const text = JSON.stringify(requests());
    expect(text).not.toMatch(/secret-query|usr_42|token/);
    expect(requests().every((line) => !('err' in line))).toBe(true);
    expect(lines.filter((line) => 'err' in line).map((line) => line['msg'])).toEqual([
      'driver down',
    ]);
  });

  it('stays silent for /health', async () => {
    const { get, lines } = await start();
    expect((await get('/health')).status).toBe(200);
    await settle();
    expect(lines).toEqual([]);
  });
});

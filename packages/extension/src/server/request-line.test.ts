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
  const get = (path: string) =>
    fetch(`${url}${path}`, { headers: { agcid: '128f1c5b806b5e5f05e49675aa8a9a10' } });
  const requests = () => recorded.lines.filter((line) => line['kind'] === 'http');
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
    const fields = requests().map((line) => [
      ...[line['level'], line['http.route'], line['http.response.status_code']],
      ...[line['http.request.method'], line['error.type']],
    ]);
    expect(fields).toEqual([
      ['info', '/api/v1/items/:id', 200, 'GET', undefined],
      ['warn', '/api/v1/missing/:id', 404, 'GET', undefined],
      ['error', '/api/v1/boom', 500, 'GET', 'Error'],
      ['warn', '(unmatched)', 404, 'GET', undefined],
    ]);
    expect(requests()[0]).toMatchObject({
      agcid: '128f1c5b806b5e5f05e49675aa8a9a10',
      extension: 'probe',
      msg: 'GET /api/v1/items/:id 200',
    });
    expect(typeof requests()[0]?.['agentage.duration_ms']).toBe('number');
  });

  it('never logs the raw URL, a query string or an id, and carries no err', async () => {
    const { get, requests, lines } = await start();
    await get('/api/v1/items/usr_42?token=secret-query');
    await get('/api/v1/boom');
    await settle();
    const text = JSON.stringify(requests());
    expect(text).not.toMatch(/secret-query|usr_42|token/);
    expect(requests().every((line) => !('exception.stacktrace' in line))).toBe(true);
    const errors = lines.filter((line) => line['kind'] === 'error');
    expect(errors.map((line) => [line['msg'], line['agentage.where']])).toEqual([
      ['Error: driver down', '/api/v1/boom'],
    ]);
  });

  it('stays silent for /health', async () => {
    const { get, lines } = await start();
    expect((await get('/health')).status).toBe(200);
    await settle();
    expect(lines).toEqual([]);
  });
});

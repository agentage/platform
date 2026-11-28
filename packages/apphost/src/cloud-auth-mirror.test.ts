// The stub router's well-known.test.mjs (app host repo), ported: the auth server metadata mirror.
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler, startOn, type TestServer } from '@agentage/extension/internal';
import { AS_PATH, authMirror, type MirrorOptions } from './cloud-auth-mirror.js';
import { closeUpstreams, cloudEnv, startCloud, type Started } from './test-support/cloud-start.js';
import { quietLog } from './test-support/cloud-upstream.js';

const ISSUER = 'https://auth.next.agentage.io';
const DOC = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/auth/oauth2/authorize` };
const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

// One answer per call in order (an Error: the fetch rejects); every URL asked is kept.
const fakeFetch = (answers: (Response | Error)[], calls: string[] = []): typeof fetch =>
  (async (url: string) => {
    calls.push(String(url));
    const answer = answers.shift() ?? reply(404, {});
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;

const servers: TestServer[] = [];
let host: Started | undefined;
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const serve = async (issuer: string | null, o: MirrorOptions) => {
  const app = express();
  app.use(authMirror(issuer, o), errorHandler(quietLog()));
  const server = await startOn(app);
  servers.push(server);
  return server;
};

describe('the auth server metadata mirror', () => {
  it('a verbatim copy, open CORS, 10 min cache header, read once in 10 minutes', async () => {
    const [calls, raw] = [[] as string[], JSON.stringify(DOC, null, 1)];
    let t = 0;
    const fetcher = fakeFetch([reply(200, raw), reply(200, raw)], calls);
    const server = await serve(ISSUER, { fetcher, now: () => t });
    const res = await server.fetch(AS_PATH);
    expect([res.status, res.headers.get('access-control-allow-origin')]).toEqual([200, '*']);
    expect([res.headers.get('cache-control'), await res.text()]).toEqual([
      'public, max-age=600',
      raw,
    ]);
    t = 9 * 60_000;
    await server.fetch(AS_PATH);
    expect(calls).toEqual([`${ISSUER}${AS_PATH}`]);
    t = 10 * 60_000;
    await server.fetch(AS_PATH);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['auth down', new TypeError('fetch failed')],
    ['404', reply(404, {})],
    ['500', reply(500, {})],
    ['not JSON', reply(200, '<html>')],
    ['no issuer', reply(200, {})],
  ])('%s: 503 with Retry-After, never 404, and not cached', async (_why, bad) => {
    const server = await serve(ISSUER, { fetcher: fakeFetch([bad, reply(200, DOC)]) });
    const res = await server.fetch(AS_PATH);
    expect([res.status, res.headers.get('retry-after')]).toEqual([503, '5']);
    expect((await server.fetch(AS_PATH)).status).toBe(200);
  });

  it('requests that come while a read runs share it: one call to auth', async () => {
    const calls: string[] = [];
    const server = await serve(ISSUER, { fetcher: fakeFetch([reply(200, DOC)], calls) });
    const all = await Promise.all([1, 2, 3].map(() => server.fetch(AS_PATH)));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(calls).toHaveLength(1);
  });

  it('auth that does not answer in readMs: 503', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('timeout')))
      )) as typeof fetch;
    const server = await serve(ISSUER, { fetcher: hang, readMs: 50 });
    expect((await server.fetch(AS_PATH)).status).toBe(503);
  });

  it('no other well-known name, no method but GET', async () => {
    const server = await serve(ISSUER, { fetcher: fakeFetch([]) });
    expect((await server.fetch('/.well-known/agentage-sync')).status).toBe(404);
    expect((await server.fetch(AS_PATH, { method: 'POST' })).status).toBe(404);
  });

  it('on a cloud host: with no issuer set, 503; with one, the copy', async () => {
    host = await startCloud(await cloudEnv({ extensions: [], upstreams: [] }));
    expect((await host.call(AS_PATH)).status).toBe(503);
    await host.stop();
    const fetcher = fakeFetch([reply(200, DOC)]);
    const env = await cloudEnv({ extensions: [], upstreams: [] }, { AGENTAGE_ISSUER: ISSUER });
    host = await startCloud(env, { fetcher });
    expect(JSON.parse((await host.call(AS_PATH)).body)).toEqual(DOC);
  });
});

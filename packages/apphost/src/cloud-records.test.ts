// The stub router's records.test.mjs (app host repo), ported to the cloud host.
import { type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { exchangesOf, fakeAuth, SESSION } from './test-support/cloud-host.js';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
  OWN,
  type Rows,
  startCloud,
  type Started,
  upstream,
  type Upstream,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const ROOT = '/.well-known/oauth-protected-resource';
const ISSUER = 'https://auth.next.agentage.io';
const resource = (scopes: string[]) => ({
  resource: OWN,
  authorization_servers: [ISSUER],
  scopes_supported: scopes,
  bearer_methods_supported: ['header'],
});
const send = (res: ServerResponse, status: number, body: string, type = 'application/json') =>
  res.writeHead(status, { 'content-type': type, 'cache-control': 'max-age=60' }).end(body);

// The upstream answers its root resource document with `status` and `body`; reads are counted.
const answers = (up: Upstream, status: number, body: unknown) => {
  const reads: string[] = [];
  up.custom = (req, res) => {
    if (req.url !== ROOT) return false;
    reads.push(req.url);
    send(res, status, typeof body === 'string' ? body : JSON.stringify(body));
    return true;
  };
  return reads;
};

// probe: api and mcp public; fixture: api public; shy: api internal.
const start = async () => {
  const probe = await upstream(docOf('probe', ['api', 'mcp']));
  const fixture = await upstream(docOf('fixture', ['api']));
  const shy = await upstream(docOf('shy', ['api']));
  const auth = fakeAuth();
  const extensions: Rows['extensions'] = [
    { id: 'probe', expose: { api: 'public', mcp: 'public' } },
    { id: 'fixture', expose: { api: 'public' } },
    { id: 'shy', expose: { api: 'internal' } },
  ];
  const ups = { probe, fixture, shy };
  const upstreams = Object.entries(ups).map(([id, up]) => ({ id, address: up.address }));
  const env = await cloudEnv({ extensions, upstreams }, { AGENTAGE_ISSUER: ISSUER });
  host = await startCloud(env, { fetcher: auth.fetcher });
  return { ...ups, auth, call: host.call };
};

describe('the root resource document', () => {
  it('one origin, the scopes of every public row, open CORS, no-store; an internal row is not read', async () => {
    const { probe, fixture, shy, call } = await start();
    answers(probe, 200, resource(['probe:read', 'probe:write']));
    answers(fixture, 200, resource(['fixture:read']));
    const shyReads = answers(shy, 200, resource(['shy:read']));
    const res = await call(ROOT);
    expect([
      res.status,
      res.headers['access-control-allow-origin'],
      res.headers['cache-control'],
    ]).toEqual([200, '*', 'no-store']);
    expect(JSON.parse(res.body)).toEqual(resource(['probe:read', 'probe:write', 'fixture:read']));
    expect(shyReads).toEqual([]);
  });

  it('a row with no token check adds nothing; no row with one at all is 404', async () => {
    const { probe, fixture, call } = await start();
    answers(probe, 200, resource(['probe:read']));
    answers(fixture, 404, '{}');
    expect(JSON.parse((await call(ROOT)).body).scopes_supported).toEqual(['probe:read']);
    await host?.stop();
    closeUpstreams();
    const again = await start();
    answers(again.probe, 404, '{}');
    answers(again.fixture, 404, '{}');
    expect((await again.call(ROOT)).status).toBe(404);
  });

  it.each([
    [500, '{}'],
    [200, '<html>'],
  ])(
    'a public row that answers %i %s, and no other row: 503, never a partial document',
    async (status, body) => {
      const { probe, call } = await start();
      answers(probe, status, body);
      const res = await call(ROOT);
      expect([res.status, res.headers['retry-after']]).toEqual([503, '5']);
    }
  );
});

describe('/{id}/.well-known/* and the mcp metadata path', () => {
  it('a record comes from its container, with open CORS and no-store over the upstream headers', async () => {
    const { call } = await start();
    const res = await call('/probe/.well-known/agentage-extension.json');
    expect([
      res.status,
      res.headers['access-control-allow-origin'],
      res.headers['cache-control'],
    ]).toEqual([200, '*', 'no-store']);
    expect(JSON.parse(res.body)).toMatchObject({ id: 'probe' });
  });

  it('a record carries no token: no exchange, no auth cookie, no bearer but a PAT', async () => {
    const { probe, auth, call } = await start();
    const seen: Record<string, unknown>[] = [];
    probe.custom = (req, res) => (seen.push(req.headers), send(res, 200, '{}'), true);
    const headers = { cookie: SESSION, authorization: 'Bearer eyJ.not.pat' };
    expect((await call('/probe/.well-known/oauth-protected-resource', { headers })).status).toBe(
      200
    );
    expect([seen[0]?.['authorization'], seen[0]?.['cookie'], exchangesOf(auth)]).toEqual([
      undefined,
      undefined,
      [],
    ]);
  });

  it('the mcp metadata path goes to the part at the same path', async () => {
    const { probe, call } = await start();
    const urls: string[] = [];
    probe.custom = (req, res) => (urls.push(req.url ?? ''), send(res, 200, '{}'), true);
    const res = await call('/.well-known/oauth-protected-resource/mcp/probe');
    expect([res.status, res.headers['access-control-allow-origin'], urls]).toEqual([
      200,
      '*',
      ['/.well-known/oauth-protected-resource/mcp/probe'],
    ]);
  });

  it.each([
    ['GET', '/probe/.well-known/other.json'],
    ['GET', '/shy/.well-known/agentage-extension.json'],
    ['GET', '/nosuch/.well-known/agentage-extension.json'],
    ['POST', '/probe/.well-known/agentage-extension.json'],
    ['GET', '/.well-known/oauth-protected-resource/mcp/shy'],
    ['GET', '/.well-known/oauth-protected-resource/mcp/nosuch'],
    ['GET', '/.well-known/oauth-protected-resource/mcp/Bad_Id'],
    ['POST', '/.well-known/oauth-protected-resource/mcp/probe'],
  ])('%s %s is 404', async (method, path) => {
    await start();
    expect((await host!.call(path, { method })).status).toBe(404);
  });

  it('a public row that no container answers for: its records are 503 with Retry-After', async () => {
    const { fixture, call } = await start();
    fixture.doc = undefined;
    await host!.refresh();
    const res = await call('/fixture/.well-known/agentage-extension.json');
    expect([res.status, res.headers['retry-after']]).toEqual([503, '5']);
  });
});

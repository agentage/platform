import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORIGIN, startIssuer, type TestIssuer } from '../test-support/issuer.js';
import {
  authEnv,
  INSUFFICIENT,
  partPackage,
  RESOURCE,
  startPart,
  STOP,
} from '../test-support/part-fixture.js';

let dir: string;
let issuer: TestIssuer;
beforeAll(async () => {
  dir = await partPackage();
});
beforeEach(async () => {
  issuer = await startIssuer();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(async () => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
  await issuer.close();
});

const start = () => startPart(dir, 'api', authEnv(issuer, dir));

describe('an api part checks tokens (C5, C6)', () => {
  it('401 without a token, 403 naming the scope, 200 with the caller; public stays open', async () => {
    const url = await start();
    const none = await fetch(`${url}/api/v1/echo`, { headers: { agcid: 'trace-401-m3' } });
    expect([none.status, none.headers.get('www-authenticate')]).toEqual([401, RESOURCE]);
    expect(await none.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing token', agcid: 'trace-401-m3' },
    });
    const memory = await issuer.bearer({ scope: 'memory:read' });
    const refused = await fetch(`${url}/api/v1/echo`, { headers: { authorization: memory } });
    expect([refused.status, refused.headers.get('www-authenticate')]).toEqual([403, INSUFFICIENT]);
    expect(await refused.json()).toMatchObject({ error: { message: 'Needs probe:read' } });
    const read = await issuer.bearer({ scope: 'probe:read', sub: 'usr_1' });
    const echo = await fetch(`${url}/api/v1/echo`, { headers: { authorization: read } });
    expect(await echo.json()).toEqual({
      success: true,
      data: { sub: 'usr_1', scopes: ['probe:read'] },
    });
    expect(await (await fetch(`${url}/api/v1/ticks`)).json()).toEqual({
      success: true,
      data: null,
    });
  });

  it('a read token gets 403 on a write route under every spelling Express routes', async () => {
    const url = await start();
    const read = await issuer.bearer({ scope: 'probe:read' });
    const write = await issuer.bearer({ scope: 'probe:write' });
    for (const path of ['/api/v1/items', '/api/v1/Items', '/api/v1/items/', '/API/V1/ITEMS/']) {
      const post = (authorization: string) =>
        fetch(`${url}${path}`, { method: 'POST', headers: { authorization } });
      expect((await post(read)).status, path).toBe(403);
      expect((await post(write)).status, path).toBe(200);
    }
  });

  it('serves the resource document and reports the auth check in /health', async () => {
    const url = await start();
    const doc = await fetch(`${url}/.well-known/oauth-protected-resource`);
    expect(doc.headers.get('access-control-allow-origin')).toBe('*');
    expect(await doc.json()).toEqual({
      resource: ORIGIN,
      authorization_servers: [issuer.url],
      scopes_supported: ['probe:read', 'probe:write'],
      bearer_methods_supported: ['header'],
    });
    const health = (await (await fetch(`${url}/health`)).json()) as { data: { checks: object } };
    expect(health.data.checks).toEqual({ auth: 'ok' });
  });

  it('the issuer down at start: the part starts and answers 503 with Retry-After 5', async () => {
    const read = await issuer.bearer({ scope: 'probe:read' });
    await issuer.close();
    const url = await start();
    const res = await fetch(`${url}/api/v1/echo`, { headers: { authorization: read } });
    expect([res.status, res.headers.get('retry-after')]).toEqual([503, '5']);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
  });
});

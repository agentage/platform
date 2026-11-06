import { request, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsOf } from '../../test-support/issuer.js';
import { createIssuer, DEV_AUDIENCE, mint, newKeys, UP_ISSUER } from './dev-issuer-app.js';

let issuer: Server;
let url: string;
beforeEach(async () => {
  issuer = createIssuer();
  await new Promise<void>((resolve) => issuer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;
});
afterEach(() => {
  vi.useRealTimers();
  issuer.close();
});

const post = (body: string, path = '/token') => fetch(`${url}${path}`, { method: 'POST', body });

describe('dev issuer', () => {
  it('answers health, CORS preflight and 404, never cached', async () => {
    const health = await fetch(`${url}/health?x=1`);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(health.headers.get('cache-control')).toBe('no-store');
    const preflight = await fetch(`${url}/token`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toBe(
      'content-type, x-client-type'
    );
    expect((await fetch(`${url}/token`)).status).toBe(404);
    expect((await fetch(`${url}/nope`, { method: 'POST' })).status).toBe(404);
  });

  it('takes sub and ttlSeconds, and refuses unknown fields, bad JSON and a large body', async () => {
    const res = await post(JSON.stringify({ scope: 'probe:admin', sub: 'usr_1', ttlSeconds: 60 }));
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: string };
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()
    ) as Record<string, number | string>;
    expect(claims['sub']).toBe('usr_1');
    expect(Number(claims['exp']) - Number(claims['iat'])).toBe(60);
    expect(new Date(expiresAt).getTime()).toBe(Number(claims['exp']) * 1000);
    const refused = { error: 'scope must be {id}:{read|write|admin}, space-separated' };
    // The padded body is valid but for its size: only the 4096 cap refuses it.
    for (const body of [
      '{"scope":"probe:read","admin":true}',
      '{nope',
      `{"scope":"probe:read"${' '.repeat(5000)}}`,
      '',
      '{"scope":"probe:read","ttlSeconds":0}',
      '{"scope":"probe:read","aud":""}',
    ]) {
      const res = await post(body);
      expect([res.status, await res.json()]).toEqual([400, refused]);
    }
  });

  it('mints with the given clock and key id', () => {
    const keys = newKeys();
    const settings = { issuer: UP_ISSUER, audience: DEV_AUDIENCE };
    const { token, expiresAt } = mint(
      keys,
      { scope: 'probe:read' },
      settings,
      Date.UTC(2026, 10, 5, 10)
    );
    expect(expiresAt).toBe('2026-11-05T11:00:00.000Z');
    const header = JSON.parse(
      Buffer.from(token.slice(4).split('.')[0] ?? '', 'base64url').toString()
    ) as { kid: string };
    expect(header.kid).toBe(keys.kid);
    expect(keys.kid).toMatch(/^dev-[0-9a-f]{8}$/);
  });

  it('mints for another audience and down to one second (test inputs, C9)', async () => {
    const res = await post('{"scope":"probe:read","aud":"other.example","ttlSeconds":1}');
    const claims = claimsOf(((await res.json()) as { token: string }).token);
    expect(claims).toMatchObject({ aud: 'other.example', iss: UP_ISSUER });
    expect(Number(claims['exp']) - Number(claims['iat'])).toBe(1);
    const plain = claimsOf(
      ((await (await post('{"scope":"probe:read"}')).json()) as { token: string }).token
    );
    expect(plain['aud']).toBe('localhost');
  });

  it('revokes a jti: listed for a day, the longest a dev token lives', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const jti = `tok_${'0'.repeat(36)}`;
    const revoked = await post(JSON.stringify({ jti }), '/revoke');
    expect([revoked.status, await revoked.json()]).toEqual([200, { jti, revoked: true }]);
    const list = await fetch(`${url}/.well-known/agentage-revoked`);
    expect(list.headers.get('cache-control')).toBe('no-store');
    const exp = Math.floor(Date.now() / 1000) + 86_400;
    const body = (await list.json()) as { revoked: object[]; generatedAt: string };
    expect(body).toEqual({ revoked: [{ jti, exp }], generatedAt: new Date().toISOString() });
    vi.setSystemTime((exp + 1) * 1000);
    const later = await (await fetch(`${url}/.well-known/agentage-revoked`)).json();
    expect(later).toMatchObject({ revoked: [] });
  });

  it('refuses a revoke with a bad body', async () => {
    for (const body of ['{}', '{nope', '{"jti":"x","more":1}']) {
      const res = await post(body, '/revoke');
      expect([res.status, await res.json()], body).toEqual([
        400,
        { error: 'jti must be a tok_ id' },
      ]);
    }
  });

  it('answers loopback and its compose name only, and pages of the local gateway only', async () => {
    // fetch sets Host itself; node:http sends the one given.
    const status = (headers: { host?: string; origin?: string }) =>
      new Promise<number | undefined>((resolve, reject) => {
        const options = { method: 'OPTIONS', headers };
        const req = request(`${url}/token`, options, (res) => resolve(res.resume().statusCode));
        req.on('error', reject).end();
      });
    for (const host of ['localhost:4281', '127.0.0.1:4281', 'issuer:3000'])
      expect(await status({ host }), host).toBe(204);
    for (const origin of ['http://localhost:4280', 'http://127.0.0.1:4280'])
      expect(await status({ origin }), origin).toBe(204);
    const lookalikes = ['http://localhost.evil.example', 'http://localhost:4280.evil.example'];
    const refusedOrigins = ['https://evil.example', ...lookalikes].map((origin) => ({ origin }));
    for (const headers of [{ host: 'evil.example' }, ...refusedOrigins])
      expect(await status(headers), JSON.stringify(headers)).toBe(403);
    expect(await status({ origin: 'http://localhost:3000' })).toBe(403);
    const refused = await fetch(`${url}/token`, { method: 'POST', headers: { origin: 'null' } });
    expect([refused.status, await refused.json()]).toEqual([
      403,
      { error: 'host or origin not allowed' },
    ]);
  });
});

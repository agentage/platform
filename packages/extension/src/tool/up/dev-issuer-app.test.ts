import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsOf } from '../../test-support/issuer.js';
import { createIssuer, DEV_AUDIENCE, DEV_ISSUER, mint, newKeys } from './dev-issuer-app.js';

let issuer: Server;
let url: string;
beforeEach(async () => {
  issuer = createIssuer();
  await new Promise<void>((resolve) => issuer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;
});
afterEach(() => void issuer.close());

const post = (body: string, path = '/token') => fetch(`${url}${path}`, { method: 'POST', body });

describe('dev issuer', () => {
  it('answers health, CORS preflight and 404, never cached', async () => {
    const health = await fetch(`${url}/health?x=1`);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(health.headers.get('cache-control')).toBe('no-store');
    const preflight = await fetch(`${url}/token`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    // A browser test that adds its own headers still gets the harness its token.
    expect(preflight.headers.get('access-control-allow-headers')).toBe('*');
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
    const settings = { issuer: DEV_ISSUER, audience: DEV_AUDIENCE };
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
    expect(claims).toMatchObject({ aud: 'other.example', iss: DEV_ISSUER });
    expect(Number(claims['exp']) - Number(claims['iat'])).toBe(1);
    const plain = claimsOf(
      ((await (await post('{"scope":"probe:read"}')).json()) as { token: string }).token
    );
    expect(plain['aud']).toBe('localhost');
  });

  it('revokes a jti it minted: listed with its exp until the exp passes', async () => {
    const { token } = (await (await post('{"scope":"probe:read","ttlSeconds":1}')).json()) as {
      token: string;
    };
    const { jti, exp } = claimsOf(token) as { jti: string; exp: number };
    const revoked = await post(JSON.stringify({ jti }), '/revoke');
    expect([revoked.status, await revoked.json()]).toEqual([200, { jti, revoked: true }]);
    const list = await fetch(`${url}/.well-known/agentage-revoked`);
    expect(list.headers.get('cache-control')).toBe('no-store');
    const body = (await list.json()) as { revoked: object[]; generatedAt: string };
    expect(body.revoked).toEqual([{ jti, exp }]);
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime((exp + 1) * 1000);
    const later = (await (await fetch(`${url}/.well-known/agentage-revoked`)).json()) as {
      revoked: object[];
    };
    vi.useRealTimers();
    expect(later.revoked).toEqual([]);
  });

  it('refuses a revoke of a jti it never minted, or a bad body', async () => {
    const unknown = await post(JSON.stringify({ jti: `tok_${'0'.repeat(36)}` }), '/revoke');
    expect([unknown.status, await unknown.json()]).toEqual([404, { error: 'unknown jti' }]);
    for (const body of ['{}', '{nope', '{"jti":"x","more":1}']) {
      const res = await post(body, '/revoke');
      expect([res.status, await res.json()], body).toEqual([
        400,
        { error: 'jti must be a tok_ id' },
      ]);
    }
  });
});

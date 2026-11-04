import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIssuer, mint, newKeys } from './dev-issuer-app.js';

let issuer: Server;
let url: string;
beforeEach(async () => {
  issuer = createIssuer();
  await new Promise<void>((resolve) => issuer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;
});
afterEach(() => void issuer.close());

const post = (body: string) => fetch(`${url}/token`, { method: 'POST', body });

describe('dev issuer', () => {
  it('answers health, CORS preflight and 404, never cached', async () => {
    const health = await fetch(`${url}/health?x=1`);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(health.headers.get('cache-control')).toBe('no-store');
    const preflight = await fetch(`${url}/token`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
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
    for (const body of [
      '{"scope":"probe:read","admin":true}',
      '{nope',
      JSON.stringify({ scope: 'probe:read', pad: 'x'.repeat(5000) }),
      '',
      '{"scope":"probe:read","ttlSeconds":5}',
    ]) {
      expect((await post(body)).status).toBe(400);
    }
  });

  it('mints with the given clock and key id', () => {
    const keys = newKeys();
    const { token, expiresAt } = mint(keys, { scope: 'probe:read' }, Date.UTC(2026, 10, 5, 10));
    expect(expiresAt).toBe('2026-11-05T11:00:00.000Z');
    const header = JSON.parse(
      Buffer.from(token.slice(4).split('.')[0] ?? '', 'base64url').toString()
    ) as { kid: string };
    expect(header.kid).toBe(keys.kid);
    expect(keys.kid).toMatch(/^dev-[0-9a-f]{8}$/);
  });
});

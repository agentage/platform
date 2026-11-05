import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import {
  AUDIENCE,
  claimsOf,
  ORIGIN,
  startIssuer,
  type TestIssuer,
} from '../test-support/issuer.js';
import { mint } from '../tool/up/dev-issuer-app.js';
import { createRevokedList } from './revoked.js';
import { type TokenCheck } from './token-check.js';
import { createTokenCheck, remoteKeys } from './verify-token.js';

const RESOURCE = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;
const unauthorized = (message: string) => ({
  code: 'UNAUTHORIZED',
  status: 401,
  message,
  headers: { 'WWW-Authenticate': RESOURCE },
});
const forbidden = (scope: string) => ({
  code: 'FORBIDDEN',
  status: 403,
  message: `Needs ${scope}`,
  headers: { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"` },
});
const UNAVAILABLE = {
  code: 'UNAVAILABLE',
  status: 503,
  message: 'Token keys unavailable',
  retryAfter: 5,
};

let issuer: TestIssuer;
let revoked: ReturnType<typeof createRevokedList>;
let check: TokenCheck;
const checkOf = (url: string) => {
  revoked = createRevokedList(url, recordedLog().log);
  const deps = { issuer: url, audience: AUDIENCE, id: 'probe', origin: ORIGIN, revoked };
  return createTokenCheck({ ...deps, keys: remoteKeys(url).keys });
};
beforeEach(async () => {
  issuer = await startIssuer();
  check = checkOf(issuer.url);
  await revoked.refresh();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await issuer.close();
});

// Signed by the issuer's own key unless another is given: only the named field is wrong.
const forged = async (given: Record<string, unknown>, claims: Record<string, unknown> = {}) => {
  const { key = issuer.keys.privateKey, ...header } = given;
  const iat = Math.floor(Date.now() / 1000);
  const base = { iss: issuer.url, aud: AUDIENCE, sub: 'usr_1', scope: 'probe:read', iat };
  const jwt = new SignJWT({ ...base, exp: iat + 600, ...claims })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid: issuer.keys.kid, ...header })
    .sign(key as never);
  return `Bearer aga_${await jwt}`;
};
const otherKey = () => generateKeyPairSync('ed25519').privateKey;

describe('the token check (C4)', () => {
  it('a public route or tool needs no token; probe:read opens read with the caller', async () => {
    expect(await check(undefined, 'public')).toBeNull();
    const bearer = await issuer.bearer({ scope: 'probe:read memory:read', sub: 'usr_1' });
    expect(await check(bearer, 'read')).toEqual({
      sub: 'usr_1',
      scopes: ['probe:read', 'memory:read'],
    });
  });

  it('a verb covers the ones below it, never above; another id never counts', async () => {
    const admin = await issuer.bearer({ scope: 'probe:admin' });
    expect(await check(admin, 'write')).toMatchObject({ scopes: ['probe:admin'] });
    const read = await issuer.bearer({ scope: 'probe:read' });
    await expect(check(read, 'write')).rejects.toMatchObject(forbidden('probe:write'));
    const memory = await issuer.bearer({ scope: 'memory:admin' });
    await expect(check(memory, 'read')).rejects.toMatchObject(forbidden('probe:read'));
  });

  it('a scope is exactly {id}:{verb}: anything longer grants nothing', async () => {
    for (const [scope, access] of [
      ['probe:admin:x', 'admin'],
      ['probe:read:junk', 'read'],
      ['probe:constructor', 'read'],
    ] as const)
      await expect(check(await forged({}, { scope }), access), scope).rejects.toMatchObject(
        forbidden(`probe:${access}`)
      );
  });

  it('the Bearer scheme in any case; the aga_ prefix exactly', async () => {
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    expect(await check(bearer.replace('Bearer', 'bEARER'), 'read')).toMatchObject({
      sub: 'usr_dev',
    });
    for (const header of [bearer.replace('aga_', 'AGA_'), `${bearer} junk`, `${bearer}  `])
      await expect(check(header, 'read'), header.slice(-6)).rejects.toMatchObject(
        unauthorized('Invalid token')
      );
  });

  it('no token, another scheme or no aga_ prefix is 401 naming the resource document', async () => {
    await expect(check(undefined, 'read')).rejects.toMatchObject(unauthorized('Missing token'));
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    for (const header of [bearer.replace('aga_', ''), bearer.replace('Bearer', 'Basic'), 'x'])
      await expect(check(header, 'read')).rejects.toMatchObject(unauthorized('Invalid token'));
  });

  it('expired, another audience or issuer, a bad signature, typ, alg or kid: 401', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const expired = await issuer.bearer({ scope: 'probe:read', ttlSeconds: 1 });
    const otherAud = await issuer.bearer({ scope: 'probe:read', aud: 'other.example' });
    const keys = issuer.keys;
    const otherIss = mint(
      keys,
      { scope: 'probe:read' },
      { issuer: 'https://x', audience: AUDIENCE }
    );
    const bad = [
      expired,
      otherAud,
      `Bearer ${otherIss.token}`,
      await forged({ key: otherKey() }),
      await forged({ typ: 'JWT' }),
      await forged({ typ: 'application/at+jwt' }),
      await forged({ typ: 'AT+JWT' }),
      await forged({}, { aud: [AUDIENCE, 'evil.example'] }),
      await forged({ alg: 'HS256', key: new Uint8Array(32) }),
      await forged({ kid: undefined }),
      await forged({}, { exp: undefined }),
      await forged({}, { sub: 5 }),
      `Bearer aga_${(await forged({})).slice(11, -4)}AAAA`,
    ];
    vi.setSystemTime(Date.now() + 2000);
    for (const [i, bearer] of bad.entries())
      await expect(check(bearer, 'read'), String(i)).rejects.toMatchObject(
        unauthorized('Invalid token')
      );
  });

  it('a revoked token is 401 once the list is read again', async () => {
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    expect(await check(bearer, 'read')).toMatchObject({ sub: 'usr_dev' });
    expect((await issuer.revoke(String(claimsOf(bearer)['jti']))).status).toBe(200);
    await revoked.refresh();
    await expect(check(bearer, 'read')).rejects.toMatchObject(unauthorized('Token revoked'));
  });

  it('keys are cached: an outage keeps known keys; an unknown kid reads them again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const reads = vi.spyOn(globalThis, 'fetch');
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    const jwks = () => reads.mock.calls.filter(([url]) => String(url).endsWith('/jwks.json'));
    await check(bearer, 'read');
    await check(bearer, 'read');
    expect(jwks()).toHaveLength(1);
    const unknown = await forged({ key: otherKey(), kid: 'rotated' });
    await expect(check(unknown, 'read')).rejects.toMatchObject(unauthorized('Invalid token'));
    vi.setSystemTime(Date.now() + 31_000);
    await expect(check(unknown, 'read')).rejects.toMatchObject(unauthorized('Invalid token'));
    expect(jwks()).toHaveLength(2);
    await issuer.close();
    expect(await check(bearer, 'read')).toMatchObject({ sub: 'usr_dev' });
    vi.setSystemTime(Date.now() + 31_000);
    await expect(check(unknown, 'read')).rejects.toMatchObject(UNAVAILABLE);
  });

  it('a failed key read is tried once more before it counts as an outage', async () => {
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    const real = globalThis.fetch;
    const reads = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => real(url, init));
    reads.mockImplementationOnce(() => Promise.reject(new TypeError('fetch failed')));
    expect(await check(bearer, 'read')).toMatchObject({ sub: 'usr_dev' });
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('no key read yet and the issuer unreachable: 503 with Retry-After, never 401', async () => {
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    await issuer.close();
    await expect(checkOf(issuer.url)(bearer, 'read')).rejects.toMatchObject(UNAVAILABLE);
  });
});

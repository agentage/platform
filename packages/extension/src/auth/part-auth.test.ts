import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { claimsOf, startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { authEnv, partPackage, startPart, STOP } from '../test-support/part-fixture.js';
import { covers, partAuth } from './part-auth.js';
import { REVOKED_POLL_MS } from './revoked.js';

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  await issuer.close();
});

const auth = (extra: Record<string, string | undefined> = {}) =>
  partAuth({ ...authEnv(issuer, dir), ...extra }, 'probe', recordedLog().log, []);
const statusOf = (check: Promise<unknown>) =>
  check.then(
    () => 200,
    (err: { status: number }) => err.status
  );

describe('the start rule', () => {
  it('covers: a wildcard is the domain at any depth, anything else one exact host', () => {
    for (const host of ['agentage.io', 'probe.agentage.io', 'probe.next.agentage.io'])
      expect(covers('*.agentage.io', host), host).toBe(true);
    for (const host of ['evilagentage.io', 'agentage.io.evil.com', 'localhost'])
      expect(covers('*.agentage.io', host), host).toBe(false);
    expect(covers('localhost', 'localhost')).toBe(true);
    expect(covers('localhost', 'probe.localhost')).toBe(false);
  });

  it('an api or mcp part without an issuer, or off its audience, does not start', async () => {
    for (const part of ['api', 'mcp']) {
      const env = authEnv(issuer, dir);
      await expect(startPart(dir, part, { ...env, AGENTAGE_ISSUER: undefined })).rejects.toThrow(
        /AGENTAGE_ISSUER/
      );
      const off = { ...env, AGENTAGE_ORIGIN: 'https://probe.example.com' };
      await expect(startPart(dir, part, off)).rejects.toThrow(
        'the host probe.example.com is not under the audience *.agentage.io'
      );
    }
  });

  it('refuses an issuer that is not an origin and an audience that is not a host', async () => {
    for (const AGENTAGE_ISSUER of [`${issuer.url}/`, `${issuer.url}/auth`, 'issuer'])
      await expect(auth({ AGENTAGE_ISSUER }), AGENTAGE_ISSUER).rejects.toThrow(/AGENTAGE_ISSUER/);
    for (const AGENTAGE_AUDIENCE of ['*.', '*.io', '*', '', 'Probe.Agentage.io', 'a b'])
      await expect(auth({ AGENTAGE_AUDIENCE }), AGENTAGE_AUDIENCE).rejects.toThrow(
        /AGENTAGE_AUDIENCE/
      );
  });

  it('under an https origin the issuer is https too', async () => {
    const origin = { AGENTAGE_ORIGIN: 'https://probe.next.agentage.io' };
    await expect(auth(origin)).rejects.toThrow(
      `the issuer ${issuer.url} is not https under the origin https://probe.next.agentage.io`
    );
  });
});

describe('the token check of a part', () => {
  it('reads the key set and the revoked list at start, then the list every 30 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const reads = vi.spyOn(globalThis, 'fetch');
    const { tokenCheck } = await auth();
    const read = reads.mock.calls.map(([url]) => String(url).replace(issuer.url, '')).sort();
    expect(read).toEqual(['/.well-known/agentage-revoked', '/.well-known/jwks.json']);
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    expect(await statusOf(tokenCheck(bearer, 'read'))).toBe(200);
    await issuer.revoke(String(claimsOf(bearer)['jti']));
    vi.advanceTimersByTime(REVOKED_POLL_MS - 1);
    expect(await statusOf(tokenCheck(bearer, 'read'))).toBe(200);
    vi.advanceTimersByTime(1);
    await expect.poll(() => statusOf(tokenCheck(bearer, 'read'))).toBe(401);
  });

  it('a key set the part cannot read at start is one warning, not a stop', async () => {
    await issuer.close();
    const { log, lines } = recordedLog();
    await partAuth(authEnv(issuer, dir), 'probe', log, []);
    expect(lines.filter((line) => line['msg'] === 'key set not read')).toHaveLength(1);
  });

  it('auth is degraded while no key set is held, though the revoked list was read', async () => {
    const real = globalThis.fetch;
    const reads = vi.spyOn(globalThis, 'fetch');
    reads.mockImplementation((input, init) =>
      String(input).endsWith('/jwks.json')
        ? Promise.reject(new TypeError('fetch failed'))
        : real(input, init)
    );
    const { tokenCheck, checks } = await auth();
    expect(await checks.auth()).toBe('degraded');
    reads.mockImplementation(real);
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    expect(await statusOf(tokenCheck(bearer, 'read'))).toBe(200);
    expect(await checks.auth()).toBe('ok');
  });

  it('until the revoked list is read, a token with a jti is 503 and auth is degraded', async () => {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      String(input).endsWith('/agentage-revoked')
        ? Promise.reject(new TypeError('fetch failed'))
        : real(input, init)
    );
    const { tokenCheck, checks } = await auth();
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    await expect(tokenCheck(bearer, 'read')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Revoked list unavailable',
      retryAfter: 5,
    });
    expect(await checks.auth()).toBe('degraded');
  });
});

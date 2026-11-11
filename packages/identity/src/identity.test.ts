import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH, HOUR_MS, USER, fakeAuth, wire } from './test-support/fake-auth.js';
import { createIdentity, type IdentityOptions, type TokenSummary } from './index.js';

const identity = (auth: ReturnType<typeof fakeAuth>, extra: Partial<IdentityOptions> = {}) =>
  createIdentity({
    authUrl: `${AUTH}/`,
    scopes: ['probe:read'],
    fetch: auth.fetch,
    ...extra,
  });

afterEach(() => vi.useRealTimers());

describe('sign-in detection', () => {
  it('resolves with the account when a session exists on load', async () => {
    const auth = fakeAuth();
    const assign = vi.fn();
    const id = identity(auth, { location: { href: 'https://x.example.test/p', assign } });
    expect(await id.account()).toEqual(USER);
    expect(await id.signIn()).toEqual(USER);
    expect(assign).not.toHaveBeenCalled();
  });

  it('sends the browser to sign-in with a return URL when there is no session', async () => {
    const auth = fakeAuth();
    auth.signOutNow();
    const assign = vi.fn();
    const id = identity(auth, { location: { href: 'https://x.example.test/p?a=1', assign } });
    expect(await id.account()).toBeNull();
    let settled = false;
    void id.signIn().then(() => (settled = true));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(assign).toHaveBeenCalledWith(
      `${AUTH}/sign-in?next=${encodeURIComponent('https://x.example.test/p?a=1')}`
    );
    expect(settled).toBe(false);
  });
});

describe('token()', () => {
  it('mints once with the browser body and caches it in memory', async () => {
    const auth = fakeAuth();
    const token = identity(auth).token();
    expect(await Promise.all([token(), token()])).toEqual(['aga_1', 'aga_1']);
    expect(await token()).toBe('aga_1');
    const mints = auth.calls.filter((c) => c.at === 'POST /account/pat');
    expect(mints).toHaveLength(1);
    expect(JSON.parse(String(mints[0]?.init.body))).toEqual(wire.mint.request.body);
    expect(mints[0]?.init.headers).toMatchObject({ authorization: 'Bearer session-jwt' });
    expect(auth.calls.every((c) => c.init.credentials === 'include')).toBe(true);
  });

  it('mints again once the cached token expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const auth = fakeAuth();
    const token = identity(auth).token();
    expect(await token()).toBe('aga_1');
    vi.setSystemTime(Date.now() + HOUR_MS);
    expect(await token()).toBe('aga_2');
  });

  it('re-mints 59 s before expiresAt and keeps the token 61 s before it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const auth = fakeAuth();
    const token = identity(auth).token();
    const mintedAt = Date.now();
    expect(await token()).toBe('aga_1');
    vi.setSystemTime(mintedAt + HOUR_MS - 61_000);
    expect(await token()).toBe('aga_1');
    vi.setSystemTime(mintedAt + HOUR_MS - 59_000);
    expect(await token()).toBe('aga_2');
  });

  it('keeps one token per hour when the client clock runs ahead of auth', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const behind = (): [number, unknown] => {
      const expiresAt = new Date(Date.now() - HOUR_MS).toISOString();
      return [201, { success: true, data: { id: 'tok_1', token: 'aga_1', expiresAt } }];
    };
    const auth = fakeAuth({ 'POST /account/pat': behind });
    const token = identity(auth).token();
    expect([await token(), await token()]).toEqual(['aga_1', 'aga_1']);
    expect(auth.at().filter((a) => a === 'POST /account/pat')).toHaveLength(1);
  });

  it('is undefined without a session and mints nothing', async () => {
    const auth = fakeAuth();
    auth.signOutNow();
    expect(await identity(auth).token()()).toBeUndefined();
    expect(auth.at()).not.toContain('POST /account/pat');
  });
});

describe('signOut()', () => {
  it('deletes the PAT before it ends the session', async () => {
    const auth = fakeAuth();
    const id = identity(auth);
    await id.token()();
    await id.signOut();
    const order = auth.at().filter((a) => a.startsWith('DELETE') || a.includes('sign-out'));
    expect(order).toEqual(['DELETE /account/pat/tok_1', 'POST /api/auth/sign-out']);
    expect(await id.token()()).toBeUndefined();
  });

  it('ends the session when the revoke fails, then rethrows', async () => {
    const error = { code: 'INTERNAL', message: 'down' };
    const auth = fakeAuth({ 'DELETE /account/pat/tok_1': () => [500, { success: false, error }] });
    const id = identity(auth);
    await id.token()();
    await expect(id.signOut()).rejects.toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(auth.at()).toContain('POST /api/auth/sign-out');
  });

  it('revokes a PAT whose mint is in flight at sign-out', async () => {
    const auth = fakeAuth();
    const id = identity(auth);
    const token = id.token();
    const pending = token();
    await id.signOut();
    expect(await pending).toBe('aga_1');
    const order = auth.at().filter((a) => a.startsWith('DELETE') || a.includes('sign-out'));
    expect(order).toEqual(['DELETE /account/pat/tok_1', 'POST /api/auth/sign-out']);
    expect(await token()).toBeUndefined();
  });

  it('ends the session without a DELETE when no PAT was minted', async () => {
    const auth = fakeAuth();
    await identity(auth).signOut();
    expect(auth.at()).toEqual(['POST /api/auth/sign-out']);
  });
});

describe('mintToken() and revokeToken()', () => {
  it('mints a JWT PAT with the label, scopes and lifetime given', async () => {
    const auth = fakeAuth();
    const mint = { label: 'cli', scopes: ['memory:read'], expiresInDays: 30 };
    expect(await identity(auth).mintToken(mint)).toMatchObject({ id: 'tok_1', token: 'aga_1' });
    const sent = auth.calls.find((c) => c.at === 'POST /account/pat');
    expect(JSON.parse(String(sent?.init.body))).toEqual({ format: 'jwt', ...mint });
  });

  it('revokes a PAT by id', async () => {
    const auth = fakeAuth();
    await expect(identity(auth).revokeToken('tok_1')).resolves.toBeUndefined();
    expect(auth.at()).toEqual(['GET /api/auth/token', 'DELETE /account/pat/tok_1']);
  });
});

describe('tokens() and errors', () => {
  it('lists the account PATs through the session JWT', async () => {
    const auth = fakeAuth();
    const rows = (wire.list.response.body as { data: TokenSummary[] }).data;
    const summary = rows.map(({ id, label, scopes, createdAt, expiresAt }) => ({
      id,
      label,
      scopes,
      createdAt,
      expiresAt,
    }));
    expect(await identity(auth).tokens()).toEqual(summary);
  });

  it('raises the auth error envelope as a typed error', async () => {
    const error = { code: 'INVALID_INPUT', message: 'scopes' };
    const auth = fakeAuth({ 'POST /account/pat': () => [400, { success: false, error }] });
    await expect(identity(auth).token()()).rejects.toMatchObject({
      name: 'IdentityError',
      ...error,
      status: 400,
    });
  });

  it('raises HTTP_<status> when a body does not match its schema', async () => {
    const auth = fakeAuth({ 'GET /api/auth/get-session': () => [200, { user: { id: 1 } }] });
    await expect(identity(auth).account()).rejects.toMatchObject({ code: 'HTTP_200', status: 200 });
  });

  it('raises NETWORK when auth cannot be reached', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('failed')));
    await expect(
      createIdentity({ authUrl: AUTH, scopes: ['probe:read'], fetch }).account()
    ).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

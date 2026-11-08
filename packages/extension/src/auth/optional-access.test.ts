import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import {
  AUDIENCE,
  claimsOf,
  ORIGIN,
  startIssuer,
  type TestIssuer,
} from '../test-support/issuer.js';
import { createRevokedList } from './revoked.js';
import { type TokenCheck } from './token-check.js';
import { createTokenCheck, remoteKeys } from './verify-token.js';

let issuer: TestIssuer;
let revoked: ReturnType<typeof createRevokedList>;
let check: TokenCheck;
beforeEach(async () => {
  issuer = await startIssuer();
  revoked = createRevokedList(issuer.url, recordedLog().log);
  const deps = { issuer: issuer.url, audience: AUDIENCE, id: 'probe', origin: ORIGIN, revoked };
  check = createTokenCheck({ ...deps, keys: remoteKeys(issuer.url).keys });
  await revoked.refresh();
});
afterEach(async () => issuer.close());

describe('optional access: anonymous, or a bearer that grants read', () => {
  it('no bearer is an anonymous caller', async () => {
    expect(await check(undefined, 'optional')).toBeNull();
  });

  it('a bad or revoked bearer is 401, never silently anonymous', async () => {
    await expect(check('Bearer aga_nope', 'optional')).rejects.toMatchObject({ status: 401 });
    const bearer = await issuer.bearer({ scope: 'probe:read' });
    await issuer.revoke(String(claimsOf(bearer)['jti']));
    await revoked.refresh();
    await expect(check(bearer, 'optional')).rejects.toMatchObject({
      status: 401,
      message: 'Token revoked',
    });
  });

  it('a valid bearer without {id}:read is 403', async () => {
    const other = await issuer.bearer({ scope: 'other:admin' });
    await expect(check(other, 'optional')).rejects.toMatchObject({
      status: 403,
      message: 'Needs probe:read',
    });
  });

  it('a valid bearer that grants read (or more) is its caller', async () => {
    const write = await issuer.bearer({ scope: 'probe:write', sub: 'usr_1' });
    expect(await check(write, 'optional')).toEqual({ sub: 'usr_1', scopes: ['probe:write'] });
  });
});

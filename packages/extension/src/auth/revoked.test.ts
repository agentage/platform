import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { claimsOf, startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { createRevokedList } from './revoked.js';

let issuer: TestIssuer;
beforeEach(async () => {
  issuer = await startIssuer();
});
afterEach(() => issuer.close());

const revokedJti = async () => {
  const jti = String(claimsOf(await issuer.bearer({ scope: 'probe:read' }))['jti']);
  expect((await issuer.revoke(jti)).status).toBe(200);
  return jti;
};

describe('the revoked list', () => {
  it('holds the ids of the last read; a failed read keeps them and says why', async () => {
    const { log, lines } = recordedLog();
    const list = createRevokedList(issuer.url, log);
    const jti = await revokedJti();
    expect(list.has(jti)).toBe(false);
    await list.refresh();
    expect(list.has(jti)).toBe(true);
    await issuer.close();
    await list.refresh();
    expect(list.has(jti)).toBe(true);
    expect(lines.at(-1)).toMatchObject({ level: 'warn', msg: 'revoked list not read' });
  });

  it('refuses a body that is not the list, keeping the last one', async () => {
    const { log, lines } = recordedLog();
    const list = createRevokedList(`${issuer.url}/token`, log);
    await list.refresh();
    expect(lines.at(-1)).toMatchObject({ level: 'warn', reason: 'the issuer answered 404' });
  });

  it('health: ok while the list is under 5 minutes old, then degraded', async () => {
    let now = 1_000_000;
    const list = createRevokedList(issuer.url, recordedLog().log, () => now);
    expect(await list.check()).toBe('ok');
    now += 5 * 60_000 + 1;
    expect(await list.check()).toBe('degraded');
    await list.refresh();
    expect(await list.check()).toBe('ok');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { claimsOf, startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { createRevokedList } from './revoked.js';

let issuer: TestIssuer;
beforeEach(async () => {
  issuer = await startIssuer();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await issuer.close();
});

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

  it('a body that is not the list, or a refusal, keeps the last list', async () => {
    const { log, lines } = recordedLog();
    const list = createRevokedList(issuer.url, log);
    const jti = await revokedJti();
    await list.refresh();
    const reads = vi.spyOn(globalThis, 'fetch');
    const answers = [
      () => Response.json({ revoked: 'none' }),
      () => new Response('', { status: 500 }),
    ];
    for (const answer of answers) {
      reads.mockImplementation(async () => answer());
      await list.refresh();
      expect(list.has(jti)).toBe(true);
    }
    expect(lines.map((line) => line['reason'])).toEqual([
      expect.stringContaining('revoked'),
      'the issuer answered 500',
    ]);
  });

  it('a failed read is tried once more before the list counts as unread', async () => {
    const list = createRevokedList(issuer.url, recordedLog().log);
    const jti = await revokedJti();
    const reads = vi.spyOn(globalThis, 'fetch');
    reads.mockRejectedValueOnce(new TypeError('fetch failed'));
    await list.refresh();
    expect([list.loaded(), list.has(jti), reads.mock.calls.length]).toEqual([true, true, 2]);
  });

  it('health: degraded until the first read and when the list is over 5 minutes old', async () => {
    let now = 1_000_000;
    const list = createRevokedList(issuer.url, recordedLog().log, () => now);
    expect([list.loaded(), await list.check()]).toEqual([false, 'degraded']);
    await list.refresh();
    expect(await list.check()).toBe('ok');
    now += 5 * 60_000 + 1;
    expect(await list.check()).toBe('degraded');
    await list.refresh();
    expect(await list.check()).toBe('ok');
  });
});

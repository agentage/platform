import { afterEach, describe, expect, it, vi } from 'vitest';
import { controlledTimeout, fakeFetch, jsonResponse } from '../test-support/fetch.js';
import { DEV_ISSUER, resolveToken } from './token.js';

const input = (hostname: string, answers: Response[], token?: string) => {
  const { fetch, calls } = fakeFetch(...answers);
  const warn = vi.fn();
  return { calls, warn, input: { id: 'probe', hostname, token, fetch, warn } };
};

afterEach(() => vi.restoreAllMocks());

describe('resolveToken', () => {
  it('takes ?token= first, without calling the issuer', async () => {
    const { calls, input: args } = input('localhost', [], 'aga_query');
    await expect(resolveToken(args)).resolves.toBe('aga_query');
    expect(calls).toHaveLength(0);
  });

  it('asks the dev issuer for {id}:read on localhost and 127.0.0.1, bounded at 5 s', async () => {
    const { timeout, signal } = controlledTimeout();
    for (const hostname of ['localhost', '127.0.0.1']) {
      const { calls, input: args } = input(hostname, [jsonResponse({ token: 'aga_dev' })]);
      await expect(resolveToken(args)).resolves.toBe('aga_dev');
      expect(calls[0]?.url).toBe(DEV_ISSUER);
      expect(calls[0]?.init).toMatchObject({ method: 'POST', body: '{"scope":"probe:read"}' });
      expect(calls[0]?.init.signal).toBe(signal);
    }
    expect(timeout.mock.calls).toEqual([[5_000], [5_000]]);
  });

  it('asks the dev issuer for ?scope= when given', async () => {
    const { calls, input: args } = input('localhost', [jsonResponse({ token: 'aga_w' })]);
    await expect(resolveToken({ ...args, scope: 'probe:write' })).resolves.toBe('aga_w');
    expect(calls[0]?.init.body).toBe('{"scope":"probe:write"}');
  });

  it('stays anonymous on a deployed host, without a warning', async () => {
    const { calls, warn, input: args } = input('probe.next.agentage.io', []);
    await expect(resolveToken(args)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once and goes anonymous when the issuer is down or answers nonsense', async () => {
    const failures: [Response[], string][] = [
      [[], 'no more answers'],
      [[jsonResponse({}, 503)], 'dev issuer answered 503'],
      [[jsonResponse({ nope: 1 })], 'dev issuer answered without a token'],
    ];
    for (const [answers, reason] of failures) {
      const { warn, input: args } = input('localhost', answers);
      await expect(resolveToken(args)).resolves.toBeUndefined();
      expect(warn.mock.calls).toEqual([
        [`agentage harness: no dev token (${reason}), calling anonymously`],
      ]);
    }
  });
});

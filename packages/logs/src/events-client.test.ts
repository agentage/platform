import { describe, expect, it, vi } from 'vitest';
import { batchesOf, createEventsClient, MAX_BATCH_ITEMS } from './events-client.js';
import { EventSchema } from './event.schema.js';

const row = (msg: string) =>
  EventSchema.parse({
    ts: '2026-11-10T09:12:03.412Z',
    level: 'info',
    kind: 'event',
    msg,
    extension: 'e2e',
    part: 'reporter',
  });

const fake = (answers: (number | 'throw')[]) => {
  const bodies: unknown[][] = [];
  const auth: string[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    const answer = answers.shift() ?? 200;
    if (answer === 'throw') throw new Error('timeout');
    const sent = JSON.parse(String(init?.body)) as unknown[];
    bodies.push(sent);
    auth.push(new Headers(init?.headers).get('authorization') ?? '');
    const data = { accepted: sent.length, rejected: 0 };
    return new Response(JSON.stringify({ success: true, data }), { status: answer });
  }) as typeof fetch;
  return { impl, bodies, auth };
};

describe('createEventsClient', () => {
  it('fills ts, level, a 32-hex agcid and the host, and posts with the token', async () => {
    const { impl, bodies, auth } = fake([200]);
    const client = createEventsClient({
      url: 'https://logs.test/',
      token: 'tok',
      host: 'next-1',
      fetch: impl,
    });
    const fields = { 'event.name': 'e2e.result', 'agentage.e2e.passed': 15 };
    const result = await client.post([
      { kind: 'event', msg: 'e2e.result', extension: 'e2e', part: 'reporter', fields },
    ]);
    expect(result).toEqual({ accepted: 1, rejected: 0 });
    expect(auth).toEqual(['Bearer tok']);
    expect(bodies[0]?.[0]).toMatchObject({
      level: 'info',
      host: 'next-1',
      agcid: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown,
    });
  });

  it('retries a network error or 5xx once, never a 4xx, then gives up with the status', async () => {
    const once = fake(['throw', 200]);
    const client = (impl: typeof fetch) =>
      createEventsClient({ url: 'https://logs.test', token: 't', fetch: impl, retryDelayMs: 0 });
    expect(
      await client(once.impl).post([{ kind: 'log', msg: 'a', extension: 'x', part: 'y' }])
    ).toEqual({ accepted: 1, rejected: 0 });
    const refused = fake([401, 200]);
    await expect(
      client(refused.impl).post([{ kind: 'log', msg: 'a', extension: 'x', part: 'y' }])
    ).rejects.toThrow(/401/);
    expect(refused.bodies).toHaveLength(1);
    const twice = fake([503, 503]);
    await expect(
      client(twice.impl).post([{ kind: 'log', msg: 'a', extension: 'x', part: 'y' }])
    ).rejects.toThrow(/503/);
  });

  it('splits batches at 1000 rows and under 1 MB', () => {
    const many = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => row(`m${i}`));
    expect(batchesOf(many).map((b) => b.length)).toEqual([1000, 1]);
    const big = Array.from({ length: 6 }, () => ({
      ...row('x'),
      fields: { blob: 'y'.repeat(200_000) },
    }));
    expect(batchesOf(big).map((b) => b.length)).toEqual([4, 2]);
  });

  it('redacts before sending and drops a row over the batch limit with a warning', async () => {
    const { impl, bodies } = fake([200]);
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const client = createEventsClient({ url: 'https://logs.test', token: 't', fetch: impl });
    const big = {
      kind: 'log' as const,
      msg: 'big',
      extension: 'x',
      part: 'y',
      fields: { list: Array(5000).fill('y'.repeat(190)) },
    };
    const small = {
      kind: 'log' as const,
      msg: 'small',
      extension: 'x',
      part: 'y',
      fields: { password: 'p' },
    };
    await client.post([big, small]);
    expect(warn).toHaveBeenCalledOnce();
    expect(bodies[0]).toMatchObject([{ msg: 'small', fields: { password: '[redacted]' } }]);
    warn.mockRestore();
  });

  const log = { kind: 'log' as const, msg: 'a', extension: 'x', part: 'y' };
  const quick = (impl: typeof fetch, timeoutMs?: number) =>
    createEventsClient({
      url: 'https://logs.test',
      token: 't',
      fetch: impl,
      retryDelayMs: 0,
      timeoutMs,
    });

  it('retries a 429 once; a 2xx with an unreadable body is never retried', async () => {
    const limited = fake([429, 200]);
    expect(await quick(limited.impl).post([log])).toEqual({ accepted: 1, rejected: 0 });
    expect(limited.bodies).toHaveLength(2);
    let calls = 0;
    const garbled = (async () => {
      calls++;
      return new Response('not json', { status: 200 });
    }) as typeof fetch;
    expect(await quick(garbled).post([log])).toEqual({ accepted: 0, rejected: 0 });
    expect(calls).toBe(1);
  });

  it('a hung ingest times out: two attempts, then a rejection', async () => {
    let calls = 0;
    const hung = ((_url: string, init?: RequestInit) => {
      calls++;
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error))
      );
    }) as typeof fetch;
    await expect(quick(hung, 10).post([log])).rejects.toThrow(/timeout|abort/i);
    expect(calls).toBe(2);
  });

  it('drops an invalid row with a warning, counts it rejected, and sends the rest', async () => {
    const { impl, bodies } = fake([200]);
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const bad = { ...log, kind: 'metric' as never };
    expect(await quick(impl).post([bad, log])).toEqual({ accepted: 1, rejected: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dropped an invalid row \(kind\)/));
    expect(bodies[0]).toHaveLength(1);
    warn.mockRestore();
  });

  it('cuts msg at 200 and masks credential values before sending; no token, no request', async () => {
    const { impl, bodies } = fake([200]);
    const jwt = `eyJhbGciOiJSUzI1NiJ9.${'p'.repeat(40)}.${'s'.repeat(40)}`;
    await quick(impl).post([{ ...log, msg: `${jwt} ${'m'.repeat(3000)}`, fields: { note: jwt } }]);
    expect(bodies[0]?.[0]).toMatchObject({ fields: { note: '[redacted]' } });
    expect((bodies[0]?.[0] as { msg: string }).msg).toMatch(/^\[redacted\] m{189}$/);
    await quick(impl).post([{ ...log, msg: `${'m'.repeat(199)}\u{1F600}` }]);
    expect((bodies[1]?.[0] as { msg: string }).msg).toBe('m'.repeat(199));
    const none = fake([200]);
    const client = createEventsClient({ url: 'https://logs.test', token: '', fetch: none.impl });
    await expect(client.post([log])).rejects.toThrow(/url and a token/);
    expect(none.bodies).toHaveLength(0);
  });
});

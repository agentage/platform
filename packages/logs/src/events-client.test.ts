import { describe, expect, it } from 'vitest';
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

  it('retries once, then gives up with the status', async () => {
    const once = fake(['throw', 200]);
    const client = (impl: typeof fetch) =>
      createEventsClient({ url: 'https://logs.test', token: 't', fetch: impl });
    expect(
      await client(once.impl).post([{ kind: 'log', msg: 'a', extension: 'x', part: 'y' }])
    ).toEqual({ accepted: 1, rejected: 0 });
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
});

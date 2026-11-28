// The stub router's feed.test.mjs (app host repo) cases 38, 46, 71, ported: the feed names the host document.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { docId } from './shell-events.js';
import {
  closeUpstreams,
  openFeed,
  startWithShell,
  type Started,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const rows = (version: string) => ({ extensions: [{ id: 'market', version }], upstreams: [] });
const start = async (version: string) => (host = await startWithShell(rows(version)));
const events = (text: string) => [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => m[1]);

// The feed text once `until` matches it, then the stream closes.
const read = async (port: number, until: RegExp, headers: Record<string, string> = {}) => {
  const feed = await openFeed(port, headers);
  await vi.waitFor(() => expect(feed.chunks.join('')).toMatch(until));
  feed.close();
  return feed.chunks.join('');
};

describe('the cloud feed names the host document (stub parity)', () => {
  it('the first frame sets the retry and the id of the host document the page loads', async () => {
    const { port, call } = await start('0.2.0');
    const text = await read(port, /\n\n/);
    expect(text).toMatch(/^retry: 1000\nid: [0-9a-f]{12}\n\n/);
    const doc: unknown = JSON.parse((await call('/.well-known/agentage-host.json')).body);
    expect(/id: (\w+)/.exec(text)?.[1]).toBe(docId(doc));
  });

  it('a reconnect after a deploy that changed the rows gets `extensions`', async () => {
    const seen = /id: (\w+)/.exec(await read((await start('0.2.0')).port, /\n\n/))?.[1] as string;
    await host?.stop();
    const text = await read((await start('0.3.0')).port, /event: /, { 'last-event-id': seen });
    expect(events(text)).toEqual(['extensions']);
    expect(text).toContain('data: {"op":"update"}');
    expect(/id: (\w+)/.exec(text)?.[1]).not.toBe(seen);
  });

  it('a reconnect with the current id, or none, gets no event', async () => {
    const { port } = await start('0.2.0');
    const first = await read(port, /\n\n/);
    const id = /id: (\w+)/.exec(first)?.[1] as string;
    const again = await read(port, /\n\n/, { 'last-event-id': id });
    await new Promise((r) => setTimeout(r, 50));
    expect(events(first + again)).toEqual([]);
  });
});

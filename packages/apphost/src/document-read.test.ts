// The stub router's discovery.test.mjs (app host repo), ported: the limits of the document read.
import { type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudDiscovery } from './cloud-discovery.js';
import { MAX_DOC_BYTES, readDocument } from './document-read.js';
import { type Entries } from './entries.js';
import { type Lane } from './lane.js';
import { closeUpstreams, docOf, OWN, quietLog, upstream } from './test-support/cloud-upstream.js';

afterEach(closeUpstreams);

const entriesAt = (id: string, address: string): Entries => {
  const lane = { child: { addresses: () => [address] } } as unknown as Lane;
  return new Map([[id, { id, install: { id }, state: 'running', version: '1.0.0', lane }]]);
};

const discoveryAt = (address: string, readMs?: number) => {
  const installation = { host: 'site', extensions: [{ id: 'fixture', version: '1.0.0' }] };
  const entries = entriesAt('fixture', address);
  const log = quietLog();
  return createCloudDiscovery({ installation, entries, own: OWN, log, onChange: vi.fn(), readMs });
};

const stateAfterRead = async (address: string) => {
  const d = discoveryAt(address);
  await d.refresh();
  return d.current().document.extensions[0]?.state;
};

const TOTAL = 16 * 1024 * 1024;
const CHUNK = Buffer.alloc(64 * 1024, 'x');

// Writes a JSON string of TOTAL bytes in chunks until done or the client closes the socket.
const streamBig = (res: ServerResponse, out: { sent: number; closed: boolean; done: boolean }) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.on('close', () => (out.closed = !out.done));
  res.write('{"pad":"');
  const next = () => {
    if (res.destroyed) return;
    if (out.sent >= TOTAL) return void ((out.done = true), res.end('"}'));
    out.sent += CHUNK.length;
    res.write(CHUNK, () => setImmediate(next));
  };
  next();
};

describe('a document over the size limit', () => {
  it('is refused and its read is cut: the client closes, the rest is never sent', async () => {
    const out = { sent: 0, closed: false, done: false };
    const up = await upstream(undefined);
    up.custom = (_req, res) => (streamBig(res, out), true);
    const read = await readDocument(up.address, 5_000);
    expect(read).toBeUndefined();
    await vi.waitFor(() => expect(out.closed).toBe(true));
    expect(out.sent).toBeGreaterThan(MAX_DOC_BYTES);
    expect(out.sent).toBeLessThan(TOTAL / 2);
    expect(await stateAfterRead(up.address)).toBe('starting');
  });
});

// A 204 or 304 has no body by the protocol: the client never reads one, whatever the server sends.
describe.each([204, 304])('a container that answers %i to the document read', (status) => {
  it('gives no document and never throws; the row stays starting', async () => {
    const up = await upstream(undefined);
    up.custom = (_req, res) => (res.writeHead(status).end(), true);
    await expect(readDocument(up.address, 1_000)).resolves.toBeUndefined();
    expect(await stateAfterRead(up.address)).toBe('starting');
  });
});

describe.each([203, 302, 404, 500])(
  'a container that answers %i with a valid document',
  (status) => {
    it('gives a document only for a 2xx: the status decides, not the body', async () => {
      const up = await upstream(undefined);
      const body = JSON.stringify(docOf('fixture'));
      up.custom = (_req, res) => (
        res.writeHead(status, { 'content-type': 'application/json' }).end(body),
        true
      );
      const read = await readDocument(up.address, 1_000);
      expect(read === undefined).toBe(status >= 300);
      expect(await stateAfterRead(up.address)).toBe(status < 300 ? 'running' : 'starting');
    });
  }
);

// A document of exactly n bytes: the fixture document with a pad.
const docOfSize = (n: number) => {
  const base = JSON.stringify({ ...docOf('fixture'), pad: '' }).length;
  return JSON.stringify({ ...docOf('fixture'), pad: 'x'.repeat(n - base) });
};

describe('the size limit, at its edge', () => {
  it.each([
    [MAX_DOC_BYTES, true],
    [MAX_DOC_BYTES + 1, false],
  ])('a document of %i bytes is read: %s', async (size, taken) => {
    const up = await upstream(undefined);
    const body = docOfSize(size);
    expect(Buffer.byteLength(body)).toBe(size);
    up.custom = (_req, res) => (res.writeHead(200).end(body), true);
    const read = await readDocument(up.address, 1_000);
    expect(read === undefined).toBe(!taken);
  });
});

describe('a small document', () => {
  it('is read', async () => {
    const up = await upstream(docOf('fixture'));
    expect(await readDocument(up.address, 1_000)).toMatchObject({ id: 'fixture' });
  });
});

describe('an upstream that never answers', () => {
  it('ready() is true after the read timeout of the first pass; the row stays starting', async () => {
    const up = await upstream(undefined);
    up.custom = () => true;
    const d = discoveryAt(up.address, 100);
    const started = Date.now();
    void d.start();
    expect(d.ready()).toBe(false);
    await vi.waitFor(() => expect(d.ready()).toBe(true));
    d.stop();
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(d.current().document.extensions[0]?.state).toBe('starting');
  });
});

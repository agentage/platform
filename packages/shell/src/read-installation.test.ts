import { describe, expect, it, vi } from 'vitest';
import { readInstallation, readOverlay, writeOverlay } from './read-installation.js';

const ROOT = 'https://agentage.io';
const URL_OF = `${ROOT}/api/v1/installations/fixture.next.agentage.io`;
const echo = { kind: 'widget', extension: 'probe', name: 'echo' } as const;
const installation = {
  target: 'fixture.next.agentage.io',
  deployments: [{ id: 'probe', url: 'https://probe.next.agentage.io' }],
  routes: { '/': { kind: 'row', children: [echo] } },
};
const overlay = { routes: { '/settings': echo } };
const token = () => Promise.resolve('aga_t');

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers }))
  );

const read = (data: unknown) =>
  readInstallation(ROOT, 'x', { fetch: answer({ success: true, data }) });

describe('readInstallation', () => {
  it('GETs the target from root and returns the envelope data with its etag', async () => {
    const fetch = answer({ success: true, data: installation }, 200, { ETag: '"v1"' });
    await expect(
      readInstallation(`${ROOT}/`, 'fixture.next.agentage.io', { fetch })
    ).resolves.toEqual({ installation, etag: '"v1"' });
    expect(fetch).toHaveBeenCalledWith(URL_OF, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });
  });

  it('sends the token as a bearer and has no etag when root sends none', async () => {
    const fetch = answer({ success: true, data: installation });
    const read = await readInstallation(ROOT, 'fixture.next.agentage.io', { token, fetch });
    expect(read.etag).toBeUndefined();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer aga_t' });
  });

  it("rejects with root's error envelope as a typed error", async () => {
    const error = { code: 'NOT_FOUND', message: 'no such target', agcid: 'c1' };
    const fetch = answer({ success: false, error }, 404);
    await expect(readInstallation(ROOT, 'x', { fetch })).rejects.toMatchObject({
      name: 'ShellError',
      ...error,
      status: 404,
    });
  });

  it('rejects a body that is no envelope as HTTP_<status>', async () => {
    const fetch = answer({ oops: true }, 502);
    await expect(readInstallation(ROOT, 'x', { fetch })).rejects.toMatchObject({
      code: 'HTTP_502',
      status: 502,
      message: `GET ${ROOT}/api/v1/installations/x: HTTP 502`,
    });
  });

  it.each(['https://probe.test/base', 'http://probe.test', 'ftp://probe.test'])(
    'rejects a deployment url %s that is not an origin',
    async (url) => {
      await expect(
        read({ ...installation, deployments: [{ id: 'probe', url }] })
      ).rejects.toThrow();
    }
  );

  it('rejects a document outside the schema', async () => {
    await expect(
      read({ ...installation, routes: { '/': { kind: 'grid', children: [] } } })
    ).rejects.toThrow();
  });

  it.each(['settings', `/${'a'.repeat(64)}`])('rejects the route key %s', async (key) => {
    await expect(read({ ...installation, routes: { [key]: echo } })).rejects.toThrow();
  });
});

describe('overlay', () => {
  it('reads the caller overlay with a bearer and returns its etag', async () => {
    const fetch = answer({ success: true, data: overlay }, 200, { ETag: '"o1"' });
    await expect(readOverlay(ROOT, 'fixture.next.agentage.io', { token, fetch })).resolves.toEqual({
      overlay,
      etag: '"o1"',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${URL_OF}/overlay`);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer aga_t' });
  });

  it('PUTs the overlay with If-Match and returns the new etag', async () => {
    const fetch = answer({ success: true, data: overlay }, 200, { ETag: '"o2"' });
    const ifMatch = '"o1"';
    await expect(
      writeOverlay(ROOT, 'fixture.next.agentage.io', overlay, { token, ifMatch, fetch })
    ).resolves.toEqual({ overlay, etag: '"o2"' });
    expect(fetch).toHaveBeenCalledWith(`${URL_OF}/overlay`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer aga_t',
        'If-Match': ifMatch,
      },
      credentials: 'omit',
      body: JSON.stringify(overlay),
    });
  });

  it('a stale If-Match rejects as PRECONDITION_FAILED', async () => {
    const error = { code: 'PRECONDITION_FAILED', message: 'changed' };
    const fetch = answer({ success: false, error }, 412);
    const options = { token, ifMatch: '"old"', fetch };
    await expect(writeOverlay(ROOT, 'x', overlay, options)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      status: 412,
    });
  });
});

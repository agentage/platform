import { afterEach, describe, expect, it, vi } from 'vitest';
import { readInstallation } from './read-installation.js';

const installation = {
  target: 'fixture.next.agentage.io',
  deployments: [{ id: 'probe', url: 'https://probe.next.agentage.io' }],
  layout: { kind: 'row', children: [{ kind: 'widget', extension: 'probe', name: 'echo' }] },
};

const answer = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

afterEach(() => vi.unstubAllGlobals());

describe('readInstallation', () => {
  it('GETs the target from root and returns the envelope data', async () => {
    const fetch = answer({ success: true, data: installation });
    vi.stubGlobal('fetch', fetch);
    await expect(
      readInstallation('https://agentage.io/', 'fixture.next.agentage.io')
    ).resolves.toEqual(installation);
    expect(fetch).toHaveBeenCalledWith(
      'https://agentage.io/api/v1/installations/fixture.next.agentage.io',
      { headers: { Accept: 'application/json' } }
    );
  });

  it('rejects an HTTP error with its status', async () => {
    vi.stubGlobal('fetch', answer({ success: false }, 404));
    await expect(readInstallation('https://agentage.io', 'x')).rejects.toThrow('HTTP 404');
  });

  it('rejects a document outside the schema', async () => {
    const bad = { ...installation, layout: { kind: 'grid', children: [] } };
    vi.stubGlobal('fetch', answer({ success: true, data: bad }));
    await expect(readInstallation('https://agentage.io', 'x')).rejects.toThrow();
  });
});

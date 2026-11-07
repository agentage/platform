// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { flush, withoutAct } from '../test-support/react.js';
import { type Host } from './host.types.js';
import { HostProvider, useHost } from './use-host.js';

const Probe = ({ seen }: { seen: (host: Host) => void }) => {
  seen(useHost());
  return null;
};

describe('useHost', () => {
  it('throws a clear error outside a widget', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = createRoot(document.createElement('div'), {
      onUncaughtError: (error) => errors.push(error),
    });
    await withoutAct(
      () => root.render(<Probe seen={() => undefined} />),
      () => expect(String(errors[0])).toMatch(/useHost\(\) must be called inside a widget/)
    );
    spy.mockRestore();
  });

  it('returns the host the provider gives', async () => {
    const host: Host = {
      tool: (() => Promise.resolve({})) as Host['tool'],
      api: () => Promise.resolve(null),
      context: { extension: 'probe', version: '0.2.0', path: '/', theme: 'dark', props: {} },
    };
    const seen = vi.fn();
    const root = createRoot(document.createElement('div'));
    await flush(() =>
      root.render(
        <HostProvider host={host}>
          <Probe seen={seen} />
        </HostProvider>
      )
    );
    expect(seen).toHaveBeenCalledWith(host);
  });
});

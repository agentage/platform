// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHost } from '../host/use-host.js';
import { type Host } from '../host/host.types.js';
import { flush, withoutAct } from '../test-support/react.js';
import { elementName, kebabCase } from './names.js';
import { registerWidgets } from './register.js';
import { type HostedElement } from './resolve-host.js';

const fakeHost = (extension: string): Host => ({
  tool: (() => Promise.resolve({})) as Host['tool'],
  api: () => Promise.resolve(null),
  context: { extension, version: '9.9.9', path: '/', theme: 'dark' },
});

const Hello = () => <p>hello from {useHost().context.extension}</p>;
const Version = () => <p>{useHost().context.version}</p>;
const Boom = (): never => {
  throw new Error('kaboom');
};

const mount = async (tag: string, before?: (el: HostedElement) => void) => {
  const el: HostedElement = document.createElement(tag);
  before?.(el);
  await flush(() => document.body.append(el));
  return el;
};

afterEach(() => {
  document.body.replaceChildren();
  globalThis.__agentageHost = undefined;
  vi.restoreAllMocks();
});

describe('registerWidgets', () => {
  it('defines {id}-{kebab name} once, with an open shadow root', async () => {
    registerWidgets('alpha', { helloWorld: Hello }, { version: '0.2.0' });
    const first = customElements.get('alpha-hello-world');
    registerWidgets('alpha', { helloWorld: Boom });
    expect(customElements.get('alpha-hello-world')).toBe(first);
    const el = await mount('alpha-hello-world', (e) => (e.host = fakeHost('from-property')));
    expect(el.shadowRoot?.mode).toBe('open');
    expect(el.shadowRoot?.textContent).toBe('hello from from-property');
    expect(el.textContent).toBe('');
  });

  it('isolates a throwing widget in its own error box', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerWidgets('beta', { boom: Boom, fine: Hello });
    const host = () => fakeHost('beta');
    globalThis.__agentageHost = host;
    const [broken, fine] = [
      document.createElement('beta-boom'),
      document.createElement('beta-fine'),
    ];
    await withoutAct(
      () => document.body.append(broken, fine),
      () => {
        const alert = broken.shadowRoot?.querySelector('[role="alert"]');
        expect(alert?.textContent).toBe('beta-boom failed: kaboom');
        expect(fine.shadowRoot?.textContent).toBe('hello from beta');
      }
    );
    expect(console.error).toHaveBeenCalledWith('[beta-boom]', expect.any(Error));
  });

  it('takes the page hook before the default bridge, and the bridge last', async () => {
    registerWidgets('gamma', { a: Hello, b: Version });
    const hook = vi.fn(() => fakeHost('hooked'));
    globalThis.__agentageHost = hook;
    const a = await mount('gamma-a');
    expect(hook).toHaveBeenCalledWith(a);
    expect(a.shadowRoot?.textContent).toBe('hello from hooked');
    globalThis.__agentageHost = undefined;
    registerWidgets('delta', { b: Version }, { version: '1.2.3' });
    const b = await mount('delta-b');
    expect(b.shadowRoot?.textContent).toBe('1.2.3');
  });

  it('keeps a moved widget and clears a removed one', async () => {
    registerWidgets('eps', { hello: Hello });
    globalThis.__agentageHost = () => fakeHost('eps');
    const el = await mount('eps-hello');
    const other = document.createElement('section');
    await flush(() => document.body.append(other));
    await flush(() => other.append(el));
    expect(el.shadowRoot?.textContent).toBe('hello from eps');
    await flush(() => el.remove());
    expect(el.shadowRoot?.childNodes).toHaveLength(0);
    await flush(() => document.body.append(el));
    expect(el.shadowRoot?.textContent).toBe('hello from eps');
  });

  it('refuses an id or a name that is not kebab-case', () => {
    expect(() => registerWidgets('Bad', { a: Hello })).toThrow(/extension id/);
    expect(() => registerWidgets('zeta', { '9lives': Hello })).toThrow(/widget name/);
  });
});

describe('names', () => {
  it('kebab-cases widget keys into element names', () => {
    expect(kebabCase('memoryStats')).toBe('memory-stats');
    expect(kebabCase('top_ten list')).toBe('top-ten-list');
    expect(elementName('probe', 'echo')).toBe('probe-echo');
  });
});

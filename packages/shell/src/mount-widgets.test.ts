// @vitest-environment jsdom
import type { Host } from '@agentage/widget';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Layout } from './installation.schema.js';
import { mountWidgets } from './mount-widgets.js';

const host: Host = { tool: vi.fn(), api: vi.fn(), context: {} as Host['context'] };
const deployments = [
  { id: 'probe', url: 'https://probe.test' },
  { id: 'memo', url: 'https://memo.test' },
];
const widgets: Record<string, { name: string; element: string; module: string }[]> = {
  'https://probe.test': [
    { name: 'echo', element: 'probe-echo', module: '/ui/0.2.0/probe.js' },
    { name: 'clock', element: 'probe-clock', module: '/ui/0.2.0/probe.js' },
  ],
  'https://memo.test': [{ name: 'list', element: 'memo-list', module: '/ui/1.0.0/memo.js' }],
};

// What a widget sees when it connects: the host must already be set (resolveHost reads it then).
const seen = new Map<string, unknown>();
const define = (name: string) => {
  if (customElements.get(name)) return;
  customElements.define(
    name,
    class extends HTMLElement {
      host?: Host;
      connectedCallback() {
        seen.set(name, this.host);
      }
    }
  );
};

const importModule = vi.fn((url: string) => {
  const defines: Record<string, string[]> = {
    'https://probe.test/ui/0.2.0/probe.js': ['probe-echo', 'probe-clock'],
    'https://memo.test/ui/1.0.0/memo.js': ['memo-list'],
  };
  const names = defines[url];
  if (!names) return Promise.reject(new Error(`cannot load ${url}`));
  names.forEach(define);
  return Promise.resolve({});
});

const fetchMock = vi.fn((url: string) => {
  const origin = url.replace('/.well-known/agentage-extension.json', '');
  const body = widgets[origin];
  return Promise.resolve(
    new Response(JSON.stringify({ id: 'x', widgets: body }), { status: body ? 200 : 404 })
  );
});

const widget = (extension: string, name: string): Layout => ({ kind: 'widget', extension, name });
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  container = document.body.appendChild(document.createElement('main'));
  seen.clear();
  fetchMock.mockClear();
  importModule.mockClear();
  hostFor.mockClear();
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

const hostFor = vi.fn(() => host);
const mount = (layout: Layout) =>
  mountWidgets(layout, { host: hostFor, container, deployments, importModule });

describe('mountWidgets', () => {
  it('places nested layouts in order, each widget element with the host set before connect', async () => {
    const layout: Layout = {
      kind: 'column',
      children: [
        widget('memo', 'list'),
        { kind: 'row', children: [widget('probe', 'echo'), widget('probe', 'clock')] },
      ],
    };
    const placed = await mount(layout);
    expect(placed.map((el) => el.tagName.toLowerCase())).toEqual([
      'memo-list',
      'probe-echo',
      'probe-clock',
    ]);
    const column = container.querySelector(':scope > [data-layout="column"]');
    expect(column?.children[0]?.tagName.toLowerCase()).toBe('memo-list');
    const row = column?.querySelector(':scope > [data-layout="row"]') as HTMLElement;
    expect([...row.children].map((el) => el.tagName.toLowerCase())).toEqual([
      'probe-echo',
      'probe-clock',
    ]);
    expect(row.style.flexDirection).toBe('row');
    expect([...seen.values()]).toEqual([host, host, host]);
  });

  it('builds one host per deployment and gives each widget its own', async () => {
    const hosts = new Map(
      deployments.map((d) => [d.id, { ...host, context: { ...host.context } }])
    );
    const placed = await mountWidgets(
      {
        kind: 'row',
        children: [widget('probe', 'echo'), widget('memo', 'list'), widget('probe', 'clock')],
      },
      { host: (d) => hosts.get(d.id) as Host, container, deployments, importModule }
    );
    expect(placed.map((el) => (el as HTMLElement & { host?: Host }).host)).toEqual([
      hosts.get('probe'),
      hosts.get('memo'),
      hosts.get('probe'),
    ]);
  });

  it('asks for a host once per deployment, not per widget', async () => {
    await mount({ kind: 'row', children: [widget('probe', 'echo'), widget('probe', 'clock')] });
    expect(hostFor).toHaveBeenCalledOnce();
    expect(hostFor).toHaveBeenCalledWith(deployments[0]);
  });

  it('imports a module from its deployment url and reads each discovery once', async () => {
    await mount({ kind: 'row', children: [widget('probe', 'echo'), widget('probe', 'clock')] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://probe.test/.well-known/agentage-extension.json'
    );
    expect(importModule).toHaveBeenCalledWith('https://probe.test/ui/0.2.0/probe.js');
  });

  it('a re-mount replaces what the container held, never duplicates', async () => {
    await mount(widget('probe', 'echo'));
    await mount(widget('probe', 'echo'));
    expect(container.children).toHaveLength(1);
  });

  it('a top-level widget mounts straight into the container', async () => {
    await mount(widget('probe', 'echo'));
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe('probe-echo');
  });

  it('reports each failing widget as its own error element and mounts the rest', async () => {
    const layout: Layout = {
      kind: 'row',
      children: [widget('probe', 'missing'), widget('ghost', 'echo'), widget('probe', 'echo')],
    };
    const placed = await mount(layout);
    expect(placed.map((el) => el.tagName.toLowerCase())).toEqual(['p', 'p', 'probe-echo']);
    const alerts = [...container.querySelectorAll('[role="alert"]')].map((el) => el.textContent);
    expect(alerts).toEqual([
      'probe missing: probe serves no widget missing',
      'ghost echo: no deployment for ghost',
    ]);
  });

  it('a module that fails to load or defines no element is reported, never thrown', async () => {
    widgets['https://memo.test']?.push({
      name: 'gone',
      element: 'memo-gone',
      module: '/ui/1.0.0/gone.js',
    });
    widgets['https://memo.test']?.push({
      name: 'blank',
      element: 'memo-blank',
      module: '/ui/1.0.0/memo.js',
    });
    const placed = await mount({
      kind: 'column',
      children: [widget('memo', 'gone'), widget('memo', 'blank')],
    });
    expect(placed.map((el) => el.textContent)).toEqual([
      'memo gone: cannot load https://memo.test/ui/1.0.0/gone.js',
      'memo blank: https://memo.test/ui/1.0.0/memo.js defines no memo-blank',
    ]);
  });

  it('an unreachable discovery becomes the error element', async () => {
    const offline = [{ id: 'probe', url: 'https://offline.test' }];
    const placed = await mountWidgets(widget('probe', 'echo'), {
      host: hostFor,
      container,
      deployments: offline,
      importModule,
    });
    expect(placed[0]?.getAttribute('data-widget-error')).toBe('probe/echo');
    expect(placed[0]?.textContent).toContain('HTTP 404');
  });
});

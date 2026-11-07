import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Host } from '../host/host.types.js';
import { FIXTURE, probePackage, tempExtension } from '../test-support/extensions.js';
import { bundle, type BundleResult } from './bundle.js';
import { main } from './main.js';

interface JsdomModule {
  JSDOM: new (html: string, options: { runScripts: 'outside-only' }) => { window: typeof window };
}

let result: BundleResult;
const temps: string[] = [];

const temp = async (pkg: unknown, index?: string) => {
  const dir = await tempExtension(pkg, index);
  temps.push(dir);
  return dir;
};

// A page of its own (jsdom has no types here): the module runs as the browser would run it.
const pageWith = async (host: Host) => {
  const { JSDOM } = (await import('jsdom' as string)) as JsdomModule;
  const { window } = new JSDOM('<!doctype html><head></head><body></body>', {
    runScripts: 'outside-only',
  });
  window.__agentageHost = () => host;
  window.eval(await readFile(result.files.module, 'utf8'));
  return window;
};

const shown = (el: Element, selector: string) => {
  const found = el.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`${selector} not shown: ${el.shadowRoot?.textContent}`);
  return found;
};

beforeAll(async () => {
  await rm(join(FIXTURE, 'dist'), { recursive: true, force: true });
  result = await bundle({ dir: FIXTURE });
}, 60_000);

afterAll(() => Promise.all(temps.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('bundle on the fixture extension', () => {
  it('writes widgets.json in the record shape, names read from the map', async () => {
    const widgets = JSON.parse(await readFile(join(FIXTURE, 'dist/ui/widgets.json'), 'utf8'));
    expect(widgets).toEqual([
      { name: 'echo', element: 'probe-echo', module: '/ui/0.2.0/probe.js' },
    ]);
    expect(result).toMatchObject({ id: 'probe', version: '0.2.0', widgets });
  });

  it('writes one minified self-contained module, no full zod, that registers on load', async () => {
    const code = await readFile(result.files.module, 'utf8');
    expect(result.files.module).toBe(join(FIXTURE, 'dist/ui/probe.js'));
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toContain('process.env');
    expect(code).not.toContain('"ZodString"');
    expect(code).toContain('--tw-border-style');
    expect(code.split('\n').length).toBeLessThan(200);
  });

  it('runs as one widget runtime: the echo calls its tool and shows the answer', async () => {
    const tool = vi.fn(() => Promise.resolve({ msg: 'pong hi' }));
    const context = {
      extension: 'probe',
      version: '0.2.0',
      path: '/',
      theme: 'dark',
      props: {},
    } as const;
    const window = await pageWith({
      tool: tool as Host['tool'],
      api: () => Promise.resolve(null),
      context,
    });
    const el = window.document.createElement('probe-echo');
    window.document.body.append(el);
    (await vi.waitFor(() => shown(el, 'button'))).click();
    await vi.waitFor(() => expect(shown(el, 'p').textContent).toBe('pong hi'));
    expect(tool).toHaveBeenCalledWith('probe__echo', { msg: 'hi' });
    expect(el.shadowRoot?.adoptedStyleSheets).toHaveLength(1);
    expect(window.document.head.innerHTML).toBe('');
  });

  it('writes harness.html for the id and version with its logic in harness.js', async () => {
    const html = await readFile(result.files.harness, 'utf8');
    expect(html).toContain('<meta name="agentage-extension" content="probe" />');
    expect(html).toContain('<meta name="agentage-version" content="0.2.0" />');
    expect(html).toContain('<script type="module" src="./harness.js"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toContain('{{');
    const script = await readFile(result.files.harnessScript, 'utf8');
    expect(script).toContain('http://localhost:4281/token');
  });
});

describe('bundle refuses', () => {
  it('a folder without package.json or a manifest without agentage.id', async () => {
    await expect(bundle({ dir: join(FIXTURE, 'src') })).rejects.toThrow(/no package.json/);
    const dir = await temp({ version: '0.1.0', agentage: { id: 'Bad' } });
    await expect(bundle({ dir })).rejects.toThrow(/agentage\.id an extension id is lowercase/);
    const noVersion = await temp({ version: 'one', agentage: { id: 'probe' } });
    await expect(bundle({ dir: noVersion })).rejects.toThrow(/version a semver/);
  });

  it('an extension without src/ui/index.ts', async () => {
    const dir = await temp(probePackage);
    await expect(bundle({ dir })).rejects.toThrow(/no ui entry/);
  });

  it('an empty map, a map that is not components, a bad name', async () => {
    const empty = await temp(probePackage, 'export const widgets = {};');
    await expect(bundle({ dir: empty })).rejects.toThrow(/the widgets map is empty/);
    const notComponents = await temp(probePackage, 'export const widgets = { echo: 1 };');
    await expect(bundle({ dir: notComponents })).rejects.toThrow(/not a React component/);
    const badName = await temp(probePackage, "export const widgets = { '9x': () => null };");
    await expect(bundle({ dir: badName })).rejects.toThrow(/widget name/);
  });
});

// Here, not in main.test.ts: two files bundling the fixture at once write the same dist/ui.
describe('agentage-widget bundle', () => {
  it('bundles the fixture and prints one line per file', async () => {
    const log: string[] = [];
    const out = {
      log: (line: string) => void log.push(line),
      error: (line: string) => void log.push(line),
    };
    expect(await main(['bundle', '--dir', FIXTURE], out)).toBe(0);
    expect(log.map((line) => line.split(/\s+/)[0])).toEqual(['module', 'widgets', 'harness']);
    expect(log[1]).toMatch(/^widgets {2}\S*dist\/ui\/widgets\.json {2}probe-echo$/);
  }, 60_000);
});

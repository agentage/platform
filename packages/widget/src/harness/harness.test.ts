// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse } from '../test-support/fetch.js';
import { readConfig } from './config.js';
import { loadWidgets, mountWidgets, pickWidgets, showProblem } from './mount.js';

const echo = { name: 'echo', element: 'probe-echo', module: '/ui/0.2.0/probe.js' };
const stats = { name: 'stats', element: 'probe-stats', module: '/ui/0.2.0/probe.js' };

const issuePaths = (error: unknown) =>
  (error as { issues: { path: PropertyKey[] }[] }).issues.map((issue) => issue.path.join('.'));

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="agentage-extension" content="probe"><meta name="agentage-version" content="0.2.0">';
  document.body.replaceChildren();
});

describe('readConfig', () => {
  it('reads the id and version from the page and the query', () => {
    expect(readConfig(document, '?widget=echo&token=aga_1')).toEqual({
      id: 'probe',
      version: '0.2.0',
      widget: 'echo',
      token: 'aga_1',
    });
    expect(readConfig(document, '')).toEqual({ id: 'probe', version: '0.2.0' });
    expect(readConfig(document, '?scope=probe:read probe:write&theme=light')).toMatchObject({
      scope: 'probe:read probe:write',
      theme: 'light',
    });
  });

  it('refuses a bad widget name and a page without the meta', () => {
    expect(() => readConfig(document, '?widget=<b>')).toThrow(/a widget name is lowercase kebab/);
    expect(() => readConfig(document, '?theme=blue')).toThrow();
    expect(() => readConfig(document, '?scope="x"')).toThrow();
    document.head.replaceChildren();
    expect(issuePaths(thrown(() => readConfig(document, '')))).toEqual(['id', 'version']);
  });
});

describe('mount', () => {
  it('loads and validates widgets.json', async () => {
    const { fetch } = fakeFetch(
      jsonResponse([echo]),
      jsonResponse({}, 404),
      jsonResponse([{ ...echo, element: 'echo' }])
    );
    await expect(loadWidgets(fetch, './widgets.json')).resolves.toEqual([echo]);
    await expect(loadWidgets(fetch, './widgets.json')).rejects.toThrow('widgets.json answered 404');
    const invalid = await loadWidgets(fetch, './widgets.json').catch((error: unknown) => error);
    expect(issuePaths(invalid)).toEqual(['0.element']);
  });

  it('mounts every widget, or only ?widget=', () => {
    expect(pickWidgets([echo, stats])).toEqual([echo, stats]);
    expect(pickWidgets([echo, stats], 'stats')).toEqual([stats]);
    expect(() => pickWidgets([echo], 'stats')).toThrow(/no widget named stats/);
    const made = mountWidgets(document.body, [echo, stats]);
    expect(made.map((el) => el.localName)).toEqual(['probe-echo', 'probe-stats']);
    expect(document.body.children).toHaveLength(2);
    const [themed] = mountWidgets(document.body, [echo], 'light');
    expect(themed?.getAttribute('data-theme')).toBe('light');
  });

  it('shows a problem as an alert', () => {
    showProblem(document.body, 'harness: boom');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('harness: boom');
  });
});

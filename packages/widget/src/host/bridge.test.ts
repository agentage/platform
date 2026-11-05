import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeFetch, jsonResponse, toolAnswer } from '../test-support/fetch.js';
import { createBridge } from './bridge.js';
import { WIDGET_VERSION } from './version.js';

afterEach(() => vi.unstubAllGlobals());

describe('createBridge', () => {
  it('reaches only its own tools and numbers its requests', async () => {
    const { fetch, calls } = fakeFetch(toolAnswer({ structuredContent: {} }), toolAnswer({}));
    const host = createBridge({ id: 'probe', version: '0.2.0', fetch });
    await host.tool('probe__echo');
    await host.tool('probe__echo', { msg: 'x' });
    await expect(host.tool('memory__search')).rejects.toMatchObject({
      code: 'FOREIGN_TOOL',
      message: 'a probe widget calls only probe__ tools',
    });
    await expect(host.tool('probex__echo')).rejects.toMatchObject({ code: 'FOREIGN_TOOL' });
    const bodies = calls.map((call) => JSON.parse(String(call.init.body)));
    expect(bodies.map((body) => body.id)).toEqual([1, 2]);
    expect(bodies[0].params.arguments).toEqual({});
    expect(bodies[0].params._meta['io.modelcontextprotocol/clientInfo']).toEqual({
      name: 'agentage-widget',
      version: WIDGET_VERSION,
    });
  });

  it('describes its context and defaults to the global fetch without a token', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ success: true, data: 1 }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { pathname: '/ui/0.2.0/harness.html' });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: light)',
    }));
    const host = createBridge({ id: 'probe', version: '0.2.0' });
    expect(host.context).toEqual({
      extension: 'probe',
      version: '0.2.0',
      path: '/ui/0.2.0/harness.html',
      theme: 'light',
    });
    await expect(host.api('/one')).resolves.toBe(1);
    expect(new Headers(calls[0]?.init.headers).has('authorization')).toBe(false);
  });

  it('uses its token only as the bearer, never on the host a widget gets', async () => {
    const { fetch, calls } = fakeFetch(toolAnswer({}));
    const token = () => Promise.resolve('aga_secret');
    const host = createBridge({ id: 'probe', version: '0.2.0', fetch, token });
    expect(Object.keys(host).sort()).toEqual(['api', 'context', 'tool']);
    expect(JSON.stringify(host)).not.toContain('aga_secret');
    await host.tool('probe__echo');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer aga_secret');
  });

  it('is dark with no media query and / with no location', () => {
    vi.stubGlobal('location', undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(createBridge({ id: 'probe', version: '1.0.0' }).context).toMatchObject({
      path: '/',
      theme: 'dark',
    });
  });
});

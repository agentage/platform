import { afterEach, describe, expect, it } from 'vitest';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, tempPackage } from '../test-support/packages.js';
import { createUiApp } from './ui-app.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-05T10:00:00Z' };
const PKG = { ...API_MANIFEST, version: '0.2.0', agentage: { id: 'probe', parts: { ui: true } } };

let served: Served | undefined;
afterEach(async () => served?.close());

const start = async () => {
  const dir = await tempPackage({
    'probe.js': 'export const x = 1;',
    'widgets.json': '[]',
    'harness.html': '<p>harness</p>',
  });
  served = await serveApp(createUiApp({ pkg: PKG, build: BUILD, log: recordedLog().log, dir }));
  return served;
};

describe('ui app', () => {
  it('serves widget files under /ui/{version}/, cached forever, CORS open', async () => {
    const s = await start();
    const res = await fetch(`${s.url}/ui/0.2.0/probe.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('export const x = 1;');
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('sends a CSP that lets widgets reach the dev issuer, without upgrade-insecure-requests', async () => {
    const s = await start();
    const csp = (await fetch(`${s.url}/ui/0.2.0/harness.html`)).headers.get(
      'content-security-policy'
    );
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' http://localhost:4281 http://127.0.0.1:4281");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('answers a miss, another version and a folder index with 404', async () => {
    const s = await start();
    for (const path of ['/ui/0.2.0/nope.js', '/ui/0.1.0/probe.js', '/ui/0.2.0/', '/probe.js']) {
      const res = await fetch(`${s.url}${path}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, tempPackage } from '../test-support/packages.js';
import { createUiApp, devIssuerOrigin } from './ui-app.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-05T10:00:00Z' };
const PKG = { ...API_MANIFEST, version: '0.2.0', agentage: { id: 'probe', parts: { ui: true } } };

let served: Served | undefined;
afterEach(async () => served?.close());

const start = async (devIssuer?: string) => {
  const dir = await tempPackage({
    'probe.js': 'export const x = 1;',
    'widgets.json': '[]',
    'harness.html': '<p>harness</p>',
  });
  const log = recordedLog().log;
  served = await serveApp(createUiApp({ pkg: PKG, build: BUILD, log, dir, devIssuer }));
  return served;
};

// Helmet's defaults plus the kit's directives; no origin or issuer here, so 'self' only.
const CSP =
  "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';" +
  "frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';" +
  "script-src-attr 'none';style-src 'self' 'unsafe-inline';connect-src 'self'";

const cspOf = async (s: Served) =>
  (await fetch(`${s.url}/ui/0.2.0/harness.html`)).headers.get('content-security-policy') ?? '';

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

  it('sends a CSP that keeps widgets on their own origin, without upgrade-insecure-requests', async () => {
    expect(await cspOf(await start())).toBe(CSP);
  });

  it('lets widgets reach the dev issuer only when up names it', async () => {
    const csp = await cspOf(await start('http://localhost:4281/'));
    expect(csp).toBe(`${CSP} http://localhost:4281`);
  });

  it('refuses to start with a dev issuer that is not a loopback http origin', () => {
    expect(devIssuerOrigin(undefined)).toBeUndefined();
    expect(devIssuerOrigin('http://127.0.0.1:4281')).toBe('http://127.0.0.1:4281');
    for (const bad of ['https://localhost:4281', 'http://auth.agentage.io', 'not a url'])
      expect(() => devIssuerOrigin(bad)).toThrow(/not a loopback http origin/);
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

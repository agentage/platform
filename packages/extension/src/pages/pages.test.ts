import { afterEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, SHA } from '../test-support/packages.js';
import { createPagesApp, NOT_FOUND_PAGE } from './pages-app.js';
import { versionPage } from './pages.js';

const BUILD = { commit: SHA, buildTime: '2026-11-05T10:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'probe', parts: { pages: true } } };

let served: Served | undefined;
afterEach(async () => served?.close());

const ctxOf = (extension: { id: string; version: string; commit: string }) =>
  createTestContext({ extension });

describe('versionPage', () => {
  it('names what runs: id version · commit', () => {
    const html = versionPage(ctxOf({ id: 'probe', version: '0.2.0', commit: SHA }));
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<title>probe</title>');
    expect(html).toContain(`<p>probe 0.2.0 · <code>${SHA}</code></p>`);
    expect(html).toContain('prefers-color-scheme:dark');
  });

  it('escapes what it prints', () => {
    const html = versionPage(ctxOf({ id: '<b>&"\'', version: '1<2', commit: 'x>y' }));
    expect(html).toContain('<title>&#60;b&#62;&#38;&#34;&#39;</title>');
    expect(html).toContain('1&#60;2 · <code>x&#62;y</code>');
    expect(html).not.toContain('<b>');
  });
});

describe('pages app', () => {
  it('serves the site map as HTML and answers anything else with an HTML 404', async () => {
    const site = { '/': '<p>home</p>', '/about.html': '<p>about</p>' };
    served = await serveApp(
      createPagesApp({ pkg: PKG, build: BUILD, log: recordedLog().log, site })
    );
    const home = await fetch(`${served.url}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toMatch(/^text\/html/);
    expect(home.headers.get('cache-control')).toBe('no-cache');
    expect(home.headers.get('content-security-policy')).not.toContain('upgrade-insecure-requests');
    expect(await home.text()).toBe('<p>home</p>');
    expect(await (await fetch(`${served.url}/about.html`)).text()).toBe('<p>about</p>');
    const miss = await fetch(`${served.url}/nope`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await miss.text()).toBe(NOT_FOUND_PAGE);
    expect((await fetch(`${served.url}/health`)).status).toBe(200);
    const doc = await fetch(`${served.url}/.well-known/agentage-extension.json`);
    expect(await doc.json()).toMatchObject({ id: 'probe', host: served.url });
  });

  it('types each file by its extension, HTML when it has none or an unknown one', async () => {
    const types: Record<string, RegExp> = {
      '/main.js': /^text\/javascript/,
      '/main.mjs': /^text\/javascript/,
      '/a.css': /^text\/css/,
      '/a.json': /^application\/json/,
      '/a.svg': /^image\/svg\+xml/,
      '/a.png': /^image\/png/,
      '/favicon.ico': /^image\/(vnd\.microsoft\.icon|x-icon)/,
      '/shell': /^text\/html/,
      '/a.xyz': /^text\/html/,
    };
    const site = Object.fromEntries(Object.keys(types).map((path) => [path, 'x']));
    served = await serveApp(
      createPagesApp({ pkg: PKG, build: BUILD, log: recordedLog().log, site })
    );
    for (const [path, type] of Object.entries(types)) {
      const res = await fetch(`${served.url}${path}`);
      expect(res.headers.get('content-type'), path).toMatch(type);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it('sends the browser CSP for its host and issuer', async () => {
    const origin = 'https://fixture.next.agentage.io';
    const issuer = 'https://auth.agentage.io';
    const app = createPagesApp({
      pkg: PKG,
      build: BUILD,
      log: recordedLog().log,
      site: {},
      origin,
      issuer,
    });
    served = await serveApp(app);
    const csp = (await fetch(`${served.url}/`)).headers.get('content-security-policy');
    expect(csp).toContain("script-src 'self' https://*.next.agentage.io;");
    expect(csp).toContain(`connect-src 'self' ${issuer} https://*.next.agentage.io`);
  });

  it('refuses a site map whose keys are not paths or whose pages are not text', () => {
    const log = recordedLog().log;
    const pages = (site: Record<string, unknown>) =>
      createPagesApp({ pkg: PKG, build: BUILD, log, site: site as Record<string, string> });
    const codes = (site: Record<string, unknown>): string[] => {
      try {
        pages(site);
        return [];
      } catch (err) {
        return err instanceof ZodError
          ? err.issues.map((i) => `${i.path.join('.')} ${i.code}`)
          : [];
      }
    };
    expect(codes({ 'about.html': '<p></p>' })).toEqual(['about.html invalid_key']);
    expect(codes({ '/a b': '<p></p>' })).toEqual(['/a b invalid_key']);
    expect(codes({ '/': 42 })).toEqual(['/ invalid_type']);
  });
});

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, SHA } from '../test-support/packages.js';
import { createPagesApp, NOT_FOUND_PAGE, platformSources } from './pages-app.js';
import { type PagesSite, versionPage } from './pages.js';

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

  it('refuses a site map whose keys are not paths or whose pages are not text or bytes', () => {
    const log = recordedLog().log;
    const pages = (site: Record<string, unknown>) =>
      createPagesApp({ pkg: PKG, build: BUILD, log, site: site as PagesSite });
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
    expect(codes({ '/a*': '<p></p>' })).toEqual(['/a* invalid_key']);
    expect(codes({ '/': { redirect: '' } })).toEqual(['/.redirect too_small']);
    expect(codes({ '/': 42 })).toEqual(['/ invalid_union']);
    expect(codes({ '/': { type: '', body: 'x' } })).toEqual(['/.type too_small']);
  });

  it('types an entry by its extension and lets a page reach the platform hosts only', async () => {
    const site = {
      '/': '<p>shell</p>',
      '/shell.js': 'export {};',
      '/a.html': '<p>a</p>',
      '/a.json': '{}',
    };
    const platform = ['https://auth.agentage.io', 'https://*.agentage.io'];
    const log = recordedLog().log;
    served = await serveApp(createPagesApp({ pkg: PKG, build: BUILD, log, site, platform }));
    const typeOf = async (path: string) =>
      (await fetch(`${served?.url}${path}`)).headers.get('content-type');
    expect(await typeOf('/shell.js')).toBe('text/javascript; charset=utf-8');
    expect(await typeOf('/a.html')).toBe('text/html; charset=utf-8');
    expect(await typeOf('/a.json')).toBe('application/json; charset=utf-8');
    const csp = (await fetch(`${served.url}/`)).headers.get('content-security-policy') ?? '';
    const allowed = "'self' https://auth.agentage.io https://*.agentage.io";
    expect(csp.split(';')).toEqual(
      expect.arrayContaining([
        "default-src 'self'",
        `script-src ${allowed}`,
        `connect-src ${allowed}`,
      ])
    );
    expect(csp).not.toContain('unsafe-eval');
  });
});

describe('inline script hashes', () => {
  const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  const policy = async (path: string, site: PagesSite) => {
    served = await serveApp(
      createPagesApp({ pkg: PKG, build: BUILD, log: recordedLog().log, site })
    );
    const csp = (await fetch(`${served.url}${path}`)).headers.get('content-security-policy') ?? '';
    return csp.split(';').find((d) => d.startsWith('script-src'));
  };

  it('allows exactly the inline scripts of an HTML page, not src or data scripts', async () => {
    const html =
      '<script>self.a=1</script><script src="/x.js"></script>' +
      '<script type="application/json">{}</script><script async>self.b=2</script>';
    expect(await policy('/', { '/': html, '/plain': '<p>no scripts</p>' })).toBe(
      `script-src 'self' ${hash('self.a=1')} ${hash('self.b=2')}`
    );
  });

  it('keeps the plain policy for a page without inline scripts', async () => {
    expect(await policy('/plain', { '/': '<script>x</script>', '/plain': '<p>hi</p>' })).toBe(
      "script-src 'self'"
    );
  });

  it('accepts $ in a path', () => {
    expect(() =>
      createPagesApp({ pkg: PKG, build: BUILD, log: recordedLog().log, site: { '/a/$x': 'y' } })
    ).not.toThrow();
  });

  it('answers a redirect with 308, a /* key by longest prefix plus the rest and the query', async () => {
    const site = {
      '/docs': { redirect: 'https://docs.example.test/' },
      '/docs/*': { redirect: 'https://docs.example.test/' },
      '/docs/old/*': { redirect: 'https://docs.example.test/new/' },
      '/app/*': '<p>shell</p>',
    };
    served = await serveApp(
      createPagesApp({ pkg: PKG, build: BUILD, log: recordedLog().log, site })
    );
    const go = async (path: string) => {
      const res = await fetch(`${served?.url}${path}`, { redirect: 'manual' });
      return `${res.status} ${res.headers.get('location') ?? ''}`;
    };
    expect(await go('/docs')).toBe('308 https://docs.example.test/');
    expect(await go('/docs/')).toBe('308 https://docs.example.test/');
    expect(await go('/docs/connect?x=1')).toBe('308 https://docs.example.test/connect?x=1');
    expect(await go('/docs/old/a/b')).toBe('308 https://docs.example.test/new/a/b');
    expect(await go('/docsx')).toBe('404 ');
    expect(await (await fetch(`${served.url}/app/a/b`)).text()).toBe('<p>shell</p>');
  });
});

const NEXT = {
  AGENTAGE_ISSUER: 'https://auth.agentage.io',
  AGENTAGE_AUDIENCE: '*.agentage.io',
  AGENTAGE_ORIGIN: 'https://fixture.next.agentage.io',
};

describe('platformSources', () => {
  it('is the issuer origin and the audience under the part origin scheme', () => {
    expect(platformSources(NEXT)).toEqual(['https://auth.agentage.io', 'https://*.agentage.io']);
    const up = { AGENTAGE_ISSUER: 'http://localhost:4281', AGENTAGE_AUDIENCE: 'localhost:4280' };
    expect(platformSources({ ...up, AGENTAGE_ORIGIN: 'http://localhost:4280' })).toEqual([
      'http://localhost:4281',
      'http://localhost:4280',
    ]);
  });

  it.each([
    ['one host with a port', 'localhost:4280', ['http://localhost:4280']],
    ['an IP', '127.0.0.1', ['http://127.0.0.1']],
    ['a wildcard over two labels', '*.agentage.io', ['http://*.agentage.io']],
    ['a wildcard over a top-level domain', '*.io', []],
    ['a bare wildcard', '*', []],
    ['a space', 'a b.io', []],
    ['a scheme', 'https://agentage.io', []],
    ['CSP syntax', "x; script-src 'unsafe-inline'", []],
    ['empty', '', []],
  ])('audience %s', (_name, audience, sources) => {
    const env = { AGENTAGE_AUDIENCE: audience, AGENTAGE_ORIGIN: 'http://localhost:4280' };
    expect(platformSources(env)).toEqual(sources);
  });

  it.each([
    ['data:', 'data:text/plain,x'],
    ['javascript:', 'javascript:alert(1)'],
    ['not a URL', 'auth.agentage.io'],
    ['empty', ''],
  ])('drops an issuer that is %s', (_name, issuer) => {
    expect(platformSources({ ...NEXT, AGENTAGE_ISSUER: issuer })).toEqual([
      'https://*.agentage.io',
    ]);
  });

  it('takes https when the origin is missing or not a web URL', () => {
    const env = { AGENTAGE_AUDIENCE: 'agentage.io', AGENTAGE_ORIGIN: 'data:x' };
    expect(platformSources(env)).toEqual(['https://agentage.io']);
    expect(platformSources({})).toEqual([]);
  });
});

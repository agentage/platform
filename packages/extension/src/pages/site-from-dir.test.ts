import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, SHA } from '../test-support/packages.js';
import { createPagesApp } from './pages-app.js';
import { type PagesSite } from './pages.js';
import { siteFromDir } from './site-from-dir.js';

const BUILD = { commit: SHA, buildTime: '2026-11-09T10:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'probe', parts: { pages: true } } };
const ORIGIN = 'https://next.agentage.io';
const PNG = Buffer.from('\x89PNG site-fqdn.sentinel.invalid\x00\xff', 'latin1');

let served: Served | undefined;
afterEach(async () => served?.close());

const exportDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  await mkdir(join(dir, 'docs', 'start'), { recursive: true });
  await mkdir(join(dir, '_next', 'static'), { recursive: true });
  const link = 'https://docs.SITE-FQDN.sentinel.invalid and https://site-fqdn.sentinel.invalid/x';
  await writeFile(join(dir, 'index.html'), `<a href="${link}">`);
  await writeFile(join(dir, 'about.html'), '<p>about</p>');
  await writeFile(join(dir, 'docs', 'start', 'index.html'), '<p>start</p>');
  await writeFile(join(dir, '_next', 'static', 'a.js'), '"//Site-Fqdn.Sentinel.Invalid"');
  await writeFile(join(dir, 'logo.png'), PNG);
  await writeFile(join(dir, 'opengraph-image'), PNG);
  await writeFile(join(dir, 'robots'), 'User-agent: *');
  return dir;
};

const serve = async (site: PagesSite) =>
  (served = await serveApp(
    createPagesApp({ pkg: PKG, build: BUILD, log: recordedLog().log, site })
  ));

describe('siteFromDir', () => {
  it('maps the export to request paths and rewrites the placeholder in text only', async () => {
    const site = siteFromDir(await exportDir(), { origin: ORIGIN });
    expect(Object.keys(site).sort()).toEqual([
      '/',
      '/_next/static/a.js',
      '/about',
      '/docs/start',
      '/logo.png',
      '/opengraph-image',
      '/robots',
    ]);
    expect(site['/']).toBe(
      '<a href="https://docs.next.agentage.io and https://next.agentage.io/x">'
    );
    expect(site['/_next/static/a.js']).toBe('"//next.agentage.io"');
    expect(Buffer.from(site['/logo.png'] as Uint8Array).equals(PNG)).toBe(true);
  });

  it('takes a placeholder of its own', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'site-'));
    await writeFile(join(dir, 'index.html'), 'http://HOST.local:1/');
    const site = siteFromDir(dir, { origin: 'http://localhost:4280', placeholder: 'host.local:1' });
    expect(site['/']).toBe('http://localhost:4280/');
  });

  it('serves bytes with their type, a types override, and HTML for a bare path', async () => {
    const types = { '/opengraph-image': 'image/png' };
    const { url } = await serve(siteFromDir(await exportDir(), { origin: ORIGIN, types }));
    const logo = await fetch(`${url}/logo.png`);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await logo.arrayBuffer()).equals(PNG)).toBe(true);
    const og = await fetch(`${url}/opengraph-image`);
    expect(og.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await og.arrayBuffer()).equals(PNG)).toBe(true);
    const robots = await fetch(`${url}/robots`);
    expect(robots.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await (await fetch(`${url}/docs/start`)).text()).toBe('<p>start</p>');
  });

  it('serves a plain Uint8Array as bytes, not JSON', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const { url } = await serve({ '/f.woff2': bytes, '/m.webmanifest': '{}' });
    const font = await fetch(`${url}/f.woff2`);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect([...new Uint8Array(await font.arrayBuffer())]).toEqual([0, 1, 2, 255]);
    const manifest = await fetch(`${url}/m.webmanifest`);
    expect(manifest.headers.get('content-type')).toMatch(/^application\/manifest\+json/);
  });
});

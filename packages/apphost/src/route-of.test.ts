// The stub router's pages.test.mjs (app host repo), ported: the site route, the reserved paths, D82.
import { describe, expect, it } from 'vitest';
import { normalPath } from './cloud-guards.js';
import { partRoute, type Route, routeOf } from './route-of.js';

const SITE: Route[] = [
  { prefix: '/api/site', id: 'site', part: 'api', upstream: 'http://a:8080', expose: 'public' },
  { prefix: '/', id: 'site', part: 'pages', upstream: 'http://b:8080', expose: 'public' },
];
const upstream = (routes: Route[], path: string) => {
  const hit = routeOf(routes, path);
  return hit && 'route' in hit ? hit.route.upstream : undefined;
};

describe('routeOf (D81, D82)', () => {
  it.each(['/', '/docs', '/blog/a-post', '/sitemap.xml', '/_next/static/a.js', '/files/x'])(
    'a path that is not reserved goes to the site: %s',
    (path) => {
      expect(routeOf(SITE, path)).toEqual({ route: SITE[1], under: '/' });
    }
  );

  it('reserved paths never reach the site; an unknown api id is a miss', () => {
    expect(upstream(SITE, '/api/site/subscribers')).toBe('http://a:8080');
    expect(routeOf(SITE, '/api/nosuch/x')).toEqual({ id: 'nosuch', part: 'api' });
    for (const path of ['/health', '/health/x', '/api', '/mcp', '/app', '/.well-known'])
      expect(routeOf(SITE, path), path).toBeUndefined();
    expect(upstream(SITE, '/app/x/y.js')).toBeUndefined();
  });

  it('a well-known name goes to the api of the pages id, under /.well-known; host documents stay', () => {
    expect(routeOf(SITE, '/.well-known/agentage.json')).toEqual({
      route: SITE[0],
      under: '/.well-known',
    });
    expect(upstream(SITE, '/.well-known/mcp-registry-auth')).toBe('http://a:8080');
    expect(routeOf(SITE, '/.well-known/agentage-host.json')).toBeUndefined();
    expect(routeOf(SITE, '/.well-known/agentage-router.json')).toBeUndefined();
    expect(upstream([SITE[1]!], '/.well-known/agentage.json')).toBe('http://b:8080');
  });

  it('a host with no public pages route routes only its parts; an internal route is never served', () => {
    const inner: Route[] = [
      { ...SITE[0]!, expose: 'internal' },
      { ...SITE[1]!, expose: 'internal' },
    ];
    for (const path of ['/', '/docs', '/.well-known/agentage.json'])
      expect(routeOf(inner, path), path).toBeUndefined();
    expect(routeOf(inner, '/api/site/x')).toEqual({ id: 'site', part: 'api' });
  });
});

describe('partRoute: one function, the policy a parameter', () => {
  const inner: Route = { ...SITE[0]!, expose: 'internal' };
  it('public takes only a public route; any takes an internal one too', () => {
    expect(partRoute([inner], 'site', 'api', 'public')).toBeUndefined();
    expect(partRoute([inner], 'site', 'api', 'any')).toBe(inner);
    expect(partRoute(SITE, 'site', 'mcp', 'any')).toBeUndefined();
    expect(partRoute(SITE, 'other', 'api', 'any')).toBeUndefined();
  });
});

describe('routeOf reads the one normalized path (requestGuard)', () => {
  it.each([
    ['/x/../api/other/y', { id: 'other', part: 'api' }],
    ['/x/%2e%2e/api/site/y', { route: SITE[0], under: '/api/site' }],
    ['/x/%2E%2E/app/site/a.js', { id: 'site', part: 'app' }],
    ['/x/../.well-known/agentage.json', { route: SITE[0], under: '/.well-known' }],
    ['/x/../health', undefined],
    ['/x/%2e%2e/health', undefined],
  ])('%s never reaches the site', (target, want) => {
    expect(routeOf(SITE, normalPath(target).split('?')[0] as string)).toEqual(want);
  });
});

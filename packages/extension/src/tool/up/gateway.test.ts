import { describe, expect, it } from 'vitest';
import { gatewayConfig, TRAEFIK_COMMAND } from './gateway.js';

const ALL = ['pages', 'ui', 'api', 'mcp', 'worker'] as const;

describe('gatewayConfig', () => {
  it('routes the url layout of the estate for the full probe', () => {
    const { http } = gatewayConfig([...ALL], '0.2.0');
    expect(Object.keys(http.services).sort()).toEqual([
      'api',
      'gateway-miss',
      'mcp',
      'pages',
      'ui',
    ]);
    expect(http.services['api']).toEqual({
      loadBalancer: { servers: [{ url: 'http://api:3000' }] },
    });
    const rules = Object.fromEntries(
      Object.entries(http.routers).map(([name, r]) => [name, [r.rule, r.priority, r.service]])
    );
    expect(rules).toMatchObject({
      api: ['PathPrefix(`/api/v1/`)', 100, 'api'],
      mcp: ['Path(`/mcp`)', 100, 'mcp'],
      ui: ['PathPrefix(`/ui/0.2.0/`)', 100, 'ui'],
      pages: ['PathPrefix(`/`)', 1, 'pages'],
      'well-known': ['PathPrefix(`/.well-known/`)', 100, 'api'],
    });
    expect(rules['host']).toBeUndefined();
    expect(http.routers['worker']).toBeUndefined();
    expect(http.routers['api']).toMatchObject({
      entryPoints: ['web'],
      middlewares: ['gateway-headers'],
    });
    expect(http.middlewares['gateway-headers'].headers).toEqual({
      contentTypeNosniff: true,
      referrerPolicy: 'strict-origin-when-cross-origin',
      frameDeny: true,
    });
  });

  it("sends a reserved-prefix miss to Traefik's own 404, under the part routers", () => {
    const { http } = gatewayConfig([...ALL], '0.2.0');
    const reserved = http.routers['reserved'];
    expect(reserved?.service).toBe('gateway-miss');
    expect(reserved?.priority).toBe(50);
    for (const prefix of ['/api/', '/mcp', '/mcp/', '/ui/', '/.well-known/', '/git/', '/health']) {
      expect(reserved?.rule).toContain(`\`${prefix}\``);
    }
    expect(http.services['gateway-miss']).toEqual({
      loadBalancer: { servers: [{ url: 'http://127.0.0.1:8081' }] },
    });
  });

  it('without pages, every other path is a miss; discovery goes to the first routed part', () => {
    const api = gatewayConfig(['api', 'worker'], '1.0.0').http;
    expect(api.routers['host']).toMatchObject({
      rule: 'PathPrefix(`/`)',
      priority: 1,
      service: 'gateway-miss',
    });
    expect(api.routers['well-known']?.service).toBe('api');
    expect(gatewayConfig(['mcp'], '1.0.0').http.routers['well-known']?.service).toBe('mcp');
    expect(gatewayConfig(['worker'], '1.0.0').http.routers['well-known']).toBeUndefined();
  });

  it('runs Traefik on the file provider with a miss entry point and a loopback ping', () => {
    expect(TRAEFIK_COMMAND).toContain('--providers.file.filename=/etc/traefik/dynamic.yml');
    expect(TRAEFIK_COMMAND).toContain('--entryPoints.miss.address=:8081');
    expect(TRAEFIK_COMMAND).toContain('--entryPoints.ping.address=127.0.0.1:8082');
  });
});

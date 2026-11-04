import { type ImagePartKind } from '../../manifest/primitives.schema.js';

export const GATEWAY_PORT = 4280;
export const ISSUER_PORT = 4281;
export const PART_PORT = 3000;
export const TRAEFIK_IMAGE =
  'traefik:v3.7.17@sha256:68ae5fe5b64ca166704b746a9e8afcd385e36b3f569a5691401bf652d57b3748';

// The URL layout of api-standards section 1, as the estate's gateway renders it.
const RESERVED =
  'PathPrefix(`/api/`) || Path(`/mcp`) || PathPrefix(`/mcp/`) || PathPrefix(`/ui/`) || PathPrefix(`/.well-known/`) || PathPrefix(`/git/`) || Path(`/health`)';

const ROUTED: readonly ImagePartKind[] = ['api', 'mcp', 'pages', 'ui'];

const ruleOf = (part: ImagePartKind, version: string): string | undefined =>
  ({
    api: 'PathPrefix(`/api/v1/`)',
    mcp: 'Path(`/mcp`)',
    ui: `PathPrefix(\`/ui/${version}/\`)`,
    pages: 'PathPrefix(`/`)',
    worker: undefined,
  })[part];

const router = (rule: string, priority: number, service: string) => ({
  rule,
  priority,
  service,
  entryPoints: ['web'],
  middlewares: ['gateway-headers'],
});

const partRouters = (parts: ImagePartKind[], version: string) => {
  const routers: Record<string, ReturnType<typeof router>> = {};
  for (const part of parts) {
    const rule = ruleOf(part, version);
    if (rule) routers[part] = router(rule, part === 'pages' ? 1 : 100, part);
  }
  const owner = ROUTED.find((part) => parts.includes(part));
  if (owner) routers['well-known'] = router('PathPrefix(`/.well-known/`)', 100, owner);
  return routers;
};

// Traefik's file provider: a reserved-prefix miss is Traefik's own 404, like the estate gateway.
export const gatewayConfig = (parts: ImagePartKind[], version: string) => {
  const routed = parts.filter((part) => ROUTED.includes(part));
  const services: Record<string, unknown> = {
    'gateway-miss': { loadBalancer: { servers: [{ url: 'http://127.0.0.1:8081' }] } },
  };
  for (const part of routed)
    services[part] = { loadBalancer: { servers: [{ url: `http://${part}:${PART_PORT}` }] } };
  const routers: Record<string, ReturnType<typeof router>> = {
    reserved: router(RESERVED, 50, 'gateway-miss'),
    ...partRouters(routed, version),
  };
  if (!routed.includes('pages')) routers['host'] = router('PathPrefix(`/`)', 1, 'gateway-miss');
  const headers = {
    contentTypeNosniff: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
    frameDeny: true,
  };
  return { http: { middlewares: { 'gateway-headers': { headers } }, services, routers } };
};

export const TRAEFIK_COMMAND = [
  '--global.checkNewVersion=false',
  '--global.sendAnonymousUsage=false',
  '--log.format=json',
  '--providers.file.filename=/etc/traefik/dynamic.yml',
  '--entryPoints.web.address=:80',
  // No routers listen here, so every request it receives gets Traefik's own 404.
  '--entryPoints.miss.address=:8081',
  '--entryPoints.ping.address=127.0.0.1:8082',
  '--ping.entryPoint=ping',
];

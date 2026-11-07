import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { hasStore, imageParts } from '../../manifest/parts.js';
import { type ImagePartKind } from '../../manifest/primitives.schema.js';
import { DEV_AUDIENCE, DEV_ISSUER, UP_ISSUER } from './dev-issuer-app.js';
import { GATEWAY_PORT, ISSUER_PORT, PART_PORT, TRAEFIK_COMMAND, TRAEFIK_IMAGE } from './gateway.js';

export const STORE_IMAGE = 'postgres:18-alpine';
const RECORD_TARGET = '/run/agentage/agentage-extension.json';
const ISSUER_ENTRY = 'node_modules/@agentage/extension/dist/tool/up/dev-issuer.js';

export interface ComposeInput {
  pkg: ExtensionPackage;
  // The compose project, one per working copy (project.ts).
  project: string;
  tags: Record<string, string>;
  recordFile: string;
  gatewayFile: string;
  // The package's seeds/: local runs only, so they reach the migrate job as a mount.
  seedsDir?: string;
}

// A local-only credential: the store has no published port, only the parts' network reaches it.
const STORE_PASSWORD = 'agentage-local';

const storeUrl = (id: string): string => `postgres://${id}:${STORE_PASSWORD}@store:5432/${id}`;

// Only the ui under `up` names the dev issuer: its CSP then lets the harness ask it for a token.
const partEnv = (pkg: ExtensionPackage, part: ImagePartKind | 'migrate') => ({
  AGENTAGE_ORIGIN: `http://localhost:${GATEWAY_PORT}`,
  AGENTAGE_ISSUER: UP_ISSUER,
  AGENTAGE_AUDIENCE: DEV_AUDIENCE,
  AGENTAGE_RECORD_FILE: RECORD_TARGET,
  ...(hasStore(pkg, 'postgres') && part !== 'ui'
    ? { AGENTAGE_STORE_URL: storeUrl(pkg.agentage.id) }
    : {}),
  ...(part === 'ui' ? { AGENTAGE_DEV_ISSUER: DEV_ISSUER } : {}),
});

const QUICK_CHECK = { interval: '2s', timeout: '3s', retries: 30 };

const storeService = (id: string) => ({
  image: STORE_IMAGE,
  environment: { POSTGRES_USER: id, POSTGRES_PASSWORD: STORE_PASSWORD, POSTGRES_DB: id },
  volumes: ['store:/var/lib/postgresql'],
  healthcheck: { test: ['CMD-SHELL', `pg_isready -U ${id} -d ${id}`], ...QUICK_CHECK },
});

const HEALTHY = { condition: 'service_healthy' };

// api and mcp read the issuer's keys and revoked list before they serve.
const dependsOn = (pkg: ExtensionPackage, part: ImagePartKind) => ({
  ...(hasStore(pkg, 'postgres') && part !== 'ui' ? { store: HEALTHY } : {}),
  ...(part === 'api' || part === 'mcp' ? { issuer: HEALTHY } : {}),
});

const partService = (input: ComposeInput, part: ImagePartKind) => ({
  image: input.tags[part],
  environment: partEnv(input.pkg, part),
  volumes: [`${input.recordFile}:${RECORD_TARGET}:ro`],
  depends_on: dependsOn(input.pkg, part),
});

const fixedServices = (input: ComposeInput, anyImage: string) => ({
  gateway: {
    image: TRAEFIK_IMAGE,
    command: TRAEFIK_COMMAND,
    ports: [`127.0.0.1:${GATEWAY_PORT}:80`],
    volumes: [`${input.gatewayFile}:/etc/traefik/dynamic.yml:ro`],
    healthcheck: { test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:8082/ping'], ...QUICK_CHECK },
  },
  issuer: {
    image: anyImage,
    command: ['node', ISSUER_ENTRY],
    ports: [`127.0.0.1:${ISSUER_PORT}:${PART_PORT}`],
    healthcheck: { start_period: '15s', start_interval: '1s' }, // the image's test, each second
    init: true, // node as PID 1 ignores SIGTERM: without it every stop waits 10 s
  },
});

const migrateService = (input: ComposeInput) => ({
  image: input.tags['api'],
  command: ['node', 'dist/store/migrate.js'],
  environment: partEnv(input.pkg, 'migrate'),
  ...(input.seedsDir ? { volumes: [`${input.seedsDir}:/app/seeds:ro`] } : {}),
  depends_on: { store: HEALTHY },
  profiles: ['jobs'],
  restart: 'no',
});

// One compose file: gateway, dev issuer, the store and its migrate job, one service per part.
export const composeFile = (input: ComposeInput) => {
  const parts = imageParts(input.pkg);
  const services: Record<string, unknown> = {};
  for (const part of parts) services[part] = partService(input, part);
  Object.assign(services, fixedServices(input, input.tags[parts[0] ?? 'api'] ?? ''));
  if (hasStore(input.pkg, 'postgres')) {
    services['store'] = storeService(input.pkg.agentage.id);
    if (input.tags['api']) services['migrate'] = migrateService(input);
  }
  const volumes = hasStore(input.pkg, 'postgres') ? { store: {} } : {};
  return { name: input.project, services, volumes };
};

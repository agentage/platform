import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { imageParts, normalizeParts } from '../../manifest/parts.js';
import { type ImagePartKind } from '../../manifest/primitives.schema.js';
import { GATEWAY_PORT, ISSUER_PORT, PART_PORT, TRAEFIK_COMMAND, TRAEFIK_IMAGE } from './gateway.js';

export const STORE_IMAGE = 'postgres:18-alpine';
const RECORD_TARGET = '/run/agentage/agentage-extension.json';
const ISSUER_ENTRY = 'node_modules/@agentage/extension/dist/tool/up/dev-issuer.js';

export interface ComposeInput {
  pkg: ExtensionPackage;
  tags: Record<string, string>;
  recordFile: string;
  gatewayFile: string;
}

export const projectName = (pkg: ExtensionPackage): string => `agentage-${pkg.agentage.id}`;

// A local-only credential: the store has no published port, only the parts' network reaches it.
const storeUrl = (id: string): string => `postgres://${id}:agentage-local@store:5432/${id}`;

const hasStore = (pkg: ExtensionPackage): boolean =>
  normalizeParts(pkg.agentage.parts).store === 'postgres';

const partEnv = (pkg: ExtensionPackage, part: ImagePartKind | 'migrate') => ({
  AGENTAGE_ORIGIN: `http://localhost:${GATEWAY_PORT}`,
  AGENTAGE_RECORD_FILE: RECORD_TARGET,
  ...(hasStore(pkg) && part !== 'ui' ? { AGENTAGE_STORE_URL: storeUrl(pkg.agentage.id) } : {}),
});

const storeService = (id: string) => ({
  image: STORE_IMAGE,
  environment: { POSTGRES_USER: id, POSTGRES_PASSWORD: 'agentage-local', POSTGRES_DB: id },
  volumes: ['store:/var/lib/postgresql'],
  healthcheck: {
    test: ['CMD-SHELL', `pg_isready -U ${id} -d ${id}`],
    interval: '2s',
    timeout: '3s',
    retries: 30,
  },
});

const partService = (input: ComposeInput, part: ImagePartKind) => ({
  image: input.tags[part],
  environment: partEnv(input.pkg, part),
  volumes: [`${input.recordFile}:${RECORD_TARGET}:ro`],
  ...(hasStore(input.pkg) && part !== 'ui'
    ? { depends_on: { store: { condition: 'service_healthy' } } }
    : {}),
});

const fixedServices = (input: ComposeInput, anyImage: string) => ({
  gateway: {
    image: TRAEFIK_IMAGE,
    command: TRAEFIK_COMMAND,
    ports: [`127.0.0.1:${GATEWAY_PORT}:80`],
    volumes: [`${input.gatewayFile}:/etc/traefik/dynamic.yml:ro`],
    healthcheck: {
      test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:8082/ping'],
      interval: '2s',
      timeout: '3s',
      retries: 30,
    },
  },
  issuer: {
    image: anyImage,
    command: ['node', ISSUER_ENTRY],
    ports: [`127.0.0.1:${ISSUER_PORT}:${PART_PORT}`],
  },
});

const migrateService = (input: ComposeInput) => ({
  image: input.tags['api'],
  command: ['node', 'dist/store/migrate.js'],
  environment: partEnv(input.pkg, 'migrate'),
  depends_on: { store: { condition: 'service_healthy' } },
  profiles: ['jobs'],
  restart: 'no',
});

// One compose file: gateway, dev issuer, the store and its migrate job, one service per part.
export const composeFile = (input: ComposeInput) => {
  const parts = imageParts(input.pkg);
  const services: Record<string, unknown> = {};
  for (const part of parts) services[part] = partService(input, part);
  Object.assign(services, fixedServices(input, input.tags[parts[0] ?? 'api'] ?? ''));
  if (hasStore(input.pkg)) {
    services['store'] = storeService(input.pkg.agentage.id);
    if (input.tags['api']) services['migrate'] = migrateService(input);
  }
  const volumes = hasStore(input.pkg) ? { store: {} } : {};
  return { name: projectName(input.pkg), services, volumes };
};

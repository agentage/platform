import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../manifest/read-manifest.js';
import { API_MANIFEST, SPEC_MANIFEST } from '../../test-support/packages.js';
import { composeFile, STORE_IMAGE } from './compose.js';
import { TRAEFIK_IMAGE } from './gateway.js';

const FULL = validateManifest(SPEC_MANIFEST);
const PARTS = ['pages', 'ui', 'api', 'mcp', 'worker'];
const TAGS = Object.fromEntries(
  PARTS.map((part) => [part, `ghcr.io/agentage/probe-${part}:0.1.0`])
);
const FILES = {
  project: 'agentage-probe-0123abcd',
  recordFile: '/x/.agentage/record.json',
  gatewayFile: '/x/.agentage/gateway.yml',
};
const RECORD_MOUNT = '/x/.agentage/record.json:/run/agentage/agentage-extension.json:ro';
const STORE_URL = 'postgres://probe:agentage-local@store:5432/probe';
// The parts read keys from the issuer over the compose network; the tokens name the same URL.
const HEALTHY = { condition: 'service_healthy' };
const TOKENS = { AGENTAGE_ISSUER: 'http://issuer:3000', AGENTAGE_AUDIENCE: 'localhost' };

type Service = Record<string, unknown>;

const servicesOf = (pkg = FULL, tags = TAGS) =>
  composeFile({ pkg, tags, ...FILES }).services as Record<string, Service>;

describe('composeFile', () => {
  it('has the store, its migrate job, one service per part, the gateway and the issuer', () => {
    const file = composeFile({ pkg: FULL, tags: TAGS, ...FILES });
    expect(file.name).toBe('agentage-probe-0123abcd');
    expect(Object.keys(file.services).sort()).toEqual(
      [...PARTS, 'gateway', 'issuer', 'migrate', 'store'].sort()
    );
    expect(file.volumes).toEqual({ store: {} });
  });

  it('keeps the store on the private network with a health check', () => {
    expect(servicesOf()['store']).toEqual({
      image: STORE_IMAGE,
      environment: {
        POSTGRES_USER: 'probe',
        POSTGRES_PASSWORD: 'agentage-local',
        POSTGRES_DB: 'probe',
      },
      volumes: ['store:/var/lib/postgresql'],
      healthcheck: expect.objectContaining({ test: ['CMD-SHELL', 'pg_isready -U probe -d probe'] }),
    });
    expect(servicesOf()['store']).not.toHaveProperty('ports');
  });

  it('runs migrate from the api image in profile jobs, after the store is healthy', () => {
    expect(servicesOf()['migrate']).toEqual({
      image: TAGS['api'],
      command: ['node', 'dist/store/migrate.js'],
      environment: {
        AGENTAGE_ORIGIN: 'http://localhost:4280',
        ...TOKENS,
        AGENTAGE_RECORD_FILE: '/run/agentage/agentage-extension.json',
        AGENTAGE_STORE_URL: STORE_URL,
      },
      depends_on: { store: { condition: 'service_healthy' } },
      profiles: ['jobs'],
      restart: 'no',
    });
  });

  it('mounts the package seeds into the migrate job only when there are any', () => {
    const seeded = composeFile({ pkg: FULL, tags: TAGS, ...FILES, seedsDir: '/x/seeds' });
    const services = seeded.services as Record<string, Service>;
    expect(services['migrate']?.['volumes']).toEqual(['/x/seeds:/app/seeds:ro']);
    expect(servicesOf()['migrate']).not.toHaveProperty('volumes');
  });

  it('mounts the record into every part; the store reaches every part but ui', () => {
    const services = servicesOf();
    for (const part of PARTS) {
      expect(services[part]).toMatchObject({ image: TAGS[part], volumes: [RECORD_MOUNT] });
      expect(services[part]?.['environment']).toMatchObject({
        AGENTAGE_ORIGIN: 'http://localhost:4280',
        ...TOKENS,
      });
    }
    expect(services['api']).toMatchObject({
      environment: { AGENTAGE_STORE_URL: STORE_URL },
      depends_on: { store: { condition: 'service_healthy' } },
    });
    expect(services['ui']?.['environment']).not.toHaveProperty('AGENTAGE_STORE_URL');
    for (const part of PARTS.filter((p) => p !== 'ui'))
      expect(services[part]?.['environment']).not.toHaveProperty('AGENTAGE_DEV_ISSUER');
    expect(services['ui']?.['environment']).toMatchObject({
      AGENTAGE_DEV_ISSUER: 'http://localhost:4281',
    });
    expect(services['ui']?.['depends_on']).toEqual({});
    for (const part of ['pages', 'worker'])
      expect(services[part]?.['depends_on'], part).toEqual({ store: HEALTHY });
    for (const part of ['api', 'mcp'])
      expect(services[part]?.['depends_on'], part).toEqual({ store: HEALTHY, issuer: HEALTHY });
  });

  it('publishes the gateway on 127.0.0.1:4280 and the dev issuer on 127.0.0.1:4281 (C9)', () => {
    const services = servicesOf();
    expect(services['gateway']).toMatchObject({
      image: TRAEFIK_IMAGE,
      ports: ['127.0.0.1:4280:80'],
      volumes: ['/x/.agentage/gateway.yml:/etc/traefik/dynamic.yml:ro'],
    });
    expect(services['issuer']).toEqual({
      image: TAGS['pages'],
      command: ['node', 'node_modules/@agentage/extension/dist/tool/up/dev-issuer.js'],
      ports: ['127.0.0.1:4281:3000'],
      healthcheck: { start_period: '15s', start_interval: '1s' },
    });
  });

  it('without a store has no store, no migrate, no volume and no store env', () => {
    const file = composeFile({ pkg: API_MANIFEST, tags: { api: TAGS['api'] ?? '' }, ...FILES });
    const services = file.services as Record<string, Service>;
    expect(Object.keys(services).sort()).toEqual(['api', 'gateway', 'issuer']);
    expect(file.volumes).toEqual({});
    expect(services['api']?.['depends_on']).toEqual({ issuer: HEALTHY });
    expect(services['api']?.['environment']).not.toHaveProperty('AGENTAGE_STORE_URL');
  });

  it('with a store but no api part, has the store and no migrate job', () => {
    const pkg = validateManifest({
      ...API_MANIFEST,
      agentage: { id: 'probe', parts: { mcp: true, store: 'postgres' } },
    });
    const services = servicesOf(pkg, { mcp: TAGS['mcp'] ?? '' });
    expect(Object.keys(services).sort()).toEqual(['gateway', 'issuer', 'mcp', 'store']);
    expect(services['store']?.['image']).toBe(STORE_IMAGE);
  });
});

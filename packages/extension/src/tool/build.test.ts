import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRecord } from '../discovery/discovery.js';
import {
  API_MANIFEST,
  DIGEST,
  json,
  SHA,
  SPEC_MANIFEST,
  tempPackage,
} from '../test-support/packages.js';
import { build, imageTag } from './build.js';
import { type Docker, type DockerBuild } from './docker.js';
import { type Run } from './exec.js';

const ENV = { COMMIT_SHA: SHA, BUILD_TIME: '2026-11-03T20:00:00Z' };

const fakes = () => {
  const commands: string[][] = [];
  const builds: DockerBuild[] = [];
  const pushes: string[] = [];
  const run: Run = async (command, args) => {
    commands.push([command, ...args]);
    return { code: 0, stdout: `${'c'.repeat(40)}\n` };
  };
  const docker: Docker = {
    build: async (options) => void builds.push(options),
    push: async (tag) => (pushes.push(tag), DIGEST),
  };
  return { run, docker, commands, builds, pushes };
};

const probeDir = (manifest: object = { ...API_MANIFEST, scripts: { build: 'tsc' } }) =>
  tempPackage({
    'package.json': json({
      ...manifest,
      repository: 'git+https://github.com/agentage/extension-probe.git',
    }),
    'package-lock.json': json({ lockfileVersion: 3 }),
    'dist/api/index.js': 'export const create = () => null;',
  });

describe('build', () => {
  it('compiles, then builds one tagged image per part with labels', async () => {
    const dir = await probeDir();
    const f = fakes();
    const result = await build({ dir, env: ENV }, { run: f.run, docker: f.docker, tmpRoot: dir });
    expect(f.commands).toEqual([['npm', 'run', 'build']]);
    expect(f.builds).toHaveLength(1);
    expect(f.builds[0]).toMatchObject({
      tag: 'ghcr.io/agentage/probe-api:0.1.0',
      buildArgs: { ...ENV, IMAGE: 'ghcr.io/agentage/probe-api:0.1.0' },
      labels: {
        'org.opencontainers.image.revision': SHA,
        'org.opencontainers.image.created': '2026-11-03T20:00:00Z',
        'org.opencontainers.image.source': 'https://github.com/agentage/extension-probe',
      },
    });
    expect(f.pushes).toEqual([]);
    expect(result).toEqual({
      id: 'probe',
      version: '0.1.0',
      commit: SHA,
      buildTime: '2026-11-03T20:00:00Z',
      images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0' }],
    });
  });

  it('with push, writes the record with the digests', async () => {
    const dir = await probeDir();
    const f = fakes();
    const result = await build(
      { dir, env: ENV, push: true, registry: 'localhost:5000/agentage' },
      { run: f.run, docker: f.docker, tmpRoot: dir }
    );
    expect(f.pushes).toEqual(['localhost:5000/agentage/probe-api:0.1.0']);
    expect(result.recordFile).toBe(join(dir, 'dist', 'agentage-extension.json'));
    const record = validateRecord(JSON.parse(await readFile(result.recordFile ?? '', 'utf8')));
    expect(record.parts).toEqual({ api: { image: `localhost:5000/agentage/probe-api@${DIGEST}` } });
    expect(record.commit).toBe(SHA);
  });

  it('takes the commit from git when CI gives none', async () => {
    const dir = await probeDir(API_MANIFEST);
    const f = fakes();
    const result = await build({ dir, env: {} }, { run: f.run, docker: f.docker, tmpRoot: dir });
    expect(f.commands).toEqual([['git', 'rev-parse', 'HEAD']]);
    expect(result.commit).toBe('c'.repeat(40));
    expect(result.buildTime).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it('refuses a short commit and the parts kit 0.1 does not build', async () => {
    const f = fakes();
    const dir = await probeDir();
    const short = build({ dir, env: { COMMIT_SHA: '9f2c3e1' } }, { run: f.run, docker: f.docker });
    await expect(short).rejects.toThrow(/full 40-hex sha/);
    const full = await probeDir(SPEC_MANIFEST);
    await expect(build({ dir: full, env: ENV }, f)).rejects.toThrow(/api part only/);
  });

  it('names images ghcr.io/agentage/{id}-{part}:{version}', () => {
    expect(imageTag('ghcr.io/agentage', API_MANIFEST, 'api')).toBe(
      'ghcr.io/agentage/probe-api:0.1.0'
    );
  });
});

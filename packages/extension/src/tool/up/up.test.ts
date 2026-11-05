import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MANIFEST } from '../../test-support/packages.js';
import { ENV, fakeDocker, PROBE, probeDir } from '../../test-support/up-fixtures.js';
import { projectName } from './project.js';
import { up } from './up.js';

describe('up', () => {
  it('builds, records, migrates, starts and prints six lines ending ready 7 parts healthy', async () => {
    const dir = await probeDir();
    const docker = fakeDocker();
    const lines: string[] = [];
    const result = await up(
      { dir, env: ENV, onLine: (line) => void lines.push(line) },
      { run: docker.run }
    );
    expect(result.parts).toBe(7);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(
      /^build {4}5 images from the release recipes +same recipe and tags as a release$/
    );
    expect(lines[1]).toMatch(/^record {3}\.agentage\/record\.json +discovery valid$/);
    expect(lines[2]).toMatch(/^store {4}postgres:18-alpine +1 migration applied · 1 seed$/);
    expect(lines[3]).toMatch(/^issuer {3}dev tokens +http:\/\/localhost:4281$/);
    expect(lines[4]).toMatch(
      /^gateway {2}http:\/\/localhost:4280 +\/ · \/ui\/0\.2\.0\/ · \/api\/v1\/ · \/mcp$/
    );
    expect(lines[5]).toMatch(/^ready {4}7 parts healthy +\d+ s$/);
    const details = [
      'same recipe and tags as a release',
      'discovery valid',
      '1 migration applied · 1 seed',
      'http://localhost:4281',
      '/ · /ui/0.2.0/ · /api/v1/ · /mcp',
    ];
    expect(lines.slice(0, 5).map((line) => line.slice(54))).toEqual(details);
  });

  it('runs the migrate job before any part starts, every command quiet', async () => {
    const dir = await probeDir();
    const docker = fakeDocker();
    await up({ dir, env: ENV }, { run: docker.run });
    expect(docker.compose()).toEqual([
      'up -d store',
      'ps -a --format json',
      'run --rm --no-deps migrate',
      'up -d --remove-orphans',
      'ps -a --format json',
    ]);
    expect(docker.calls[0]?.args.slice(0, 3)).toEqual(['docker', 'ps', '--format']);
    expect(docker.calls[1]?.args).toEqual(['npm', 'run', 'build']);
    expect(docker.calls.filter((c) => c.args[1] === 'build')).toHaveLength(5);
    expect(docker.calls.every((c) => c.options?.quiet === true)).toBe(true);
    const composeArgs = docker.calls.find((c) => c.args[1] === 'compose')?.args.slice(0, 6);
    expect(composeArgs).toEqual([
      'docker',
      'compose',
      '-f',
      join(await realpath(dir), '.agentage/compose.json'),
      '-p',
      projectName('probe', await realpath(dir)),
    ]);
  });

  it('without a store or cli skips those steps', async () => {
    const dir = await probeDir({ ...API_MANIFEST, scripts: {} });
    const lines: string[] = [];
    const result = await up(
      { dir, env: ENV, onLine: (line) => void lines.push(line) },
      { run: fakeDocker().run }
    );
    expect(result.parts).toBe(1);
    expect(lines.map((line) => line.split(' ')[0])).toEqual([
      'build',
      'record',
      'issuer',
      'gateway',
      'ready',
    ]);
    expect(lines[0]).toMatch(/^build {4}1 image from the release recipes/);
    expect(lines[3]).toMatch(/\/api\/v1\/$/);
    expect(lines[4]).toMatch(/^ready {4}1 part healthy/);
  });

  it('fails on a cli entry that does not match the commands, and on a broken part', async () => {
    const cli = 'export const create = () => ({});';
    const before = fakeDocker();
    await expect(
      up({ dir: await probeDir(PROBE, cli), env: ENV }, { run: before.run })
    ).rejects.toThrow(
      'check failed: entries: cli part: cli handlers [] differ from commands [ping]'
    );
    expect(before.calls.filter((c) => c.args[1] === 'build' || c.args[1] === 'compose')).toEqual(
      []
    );
    const broken = fakeDocker({ mcp: 'unhealthy' });
    await expect(up({ dir: await probeDir(), env: ENV }, { run: broken.run })).rejects.toThrow(
      /^mcp is unhealthy/
    );
  });

  it('says what a kept store already had, migrations and seeds', async () => {
    const lines: string[] = [];
    const migrate = '{"migrations":2,"applied":0,"seeds":0,"seedsBefore":1}\n';
    await up(
      { dir: await probeDir(), env: ENV, onLine: (line) => void lines.push(line) },
      { run: fakeDocker({}, { migrate }).run }
    );
    expect(lines[2]).toMatch(
      /^store {4}postgres:18-alpine +2 migrations already applied · 1 seed already applied$/
    );
  });

  it('refuses before building when another project holds the gateway or issuer port', async () => {
    const dir = await probeDir();
    const other = 'agentage-probe-1-gateway-1\tagentage-probe-ffffffff\t127.0.0.1:4280->80/tcp';
    const docker = fakeDocker({}, { running: [other] });
    await expect(up({ dir, env: ENV }, { run: docker.run })).rejects.toThrow(
      'localhost:4280 is held by compose project agentage-probe-ffffffff: run agentage extension down in the working copy that started it, then up again'
    );
    expect(docker.calls).toHaveLength(1);
    const stray = fakeDocker(
      {},
      { running: ['web\t\t0.0.0.0:4281->3000/tcp, [::]:4281->3000/tcp'] }
    );
    await expect(up({ dir, env: ENV }, { run: stray.run })).rejects.toThrow(
      'localhost:4281 is held by container web: stop it, then up again'
    );
  });

  it('checks the ports again after the build, before the store and migrate run', async () => {
    const other = 'g-1\tagentage-probe-ffffffff\t127.0.0.1:4280->80/tcp';
    const docker = fakeDocker({}, { running: ['', other] });
    await expect(up({ dir: await probeDir(), env: ENV }, { run: docker.run })).rejects.toThrow(
      /^localhost:4280 is held by compose project agentage-probe-ffffffff/
    );
    expect(docker.calls.filter((c) => c.args[1] === 'build')).toHaveLength(5);
    expect(docker.compose()).toEqual([]);
  });

  it('runs again over its own project: the ports it holds are no refusal', async () => {
    const dir = await probeDir();
    const own = projectName('probe', await realpath(dir));
    const running = `${own}-gateway-1\t${own}\t127.0.0.1:4280->80/tcp\nother\tx\t0.0.0.0:14280->80/tcp`;
    const result = await up({ dir, env: ENV }, { run: fakeDocker({}, { running: [running] }).run });
    expect(result).toMatchObject({ parts: 7, project: own });
  });

  it('a failed migrate job stops up before any part starts, naming the file', async () => {
    const migrateFails = 'migration 002-bad.sql failed: syntax error at or near "tabel"\n';
    const docker = fakeDocker({}, { migrateFails });
    await expect(up({ dir: await probeDir(), env: ENV }, { run: docker.run })).rejects.toThrow(
      /^the migrate job failed, no part was started: docker compose failed with exit code 1\nmigration 002-bad\.sql failed/
    );
    expect(docker.compose()).not.toContain('up -d --remove-orphans');
  });
});

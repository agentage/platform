import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_MANIFEST } from '../../test-support/packages.js';
import { ENV, fakeDocker, PROBE, probeDir } from '../../test-support/up-fixtures.js';
import { type Run } from '../exec.js';
import { TIMEOUTS } from '../timeouts.js';
import { projectName } from './project.js';
import { up } from './up.js';

// up on a clock the package build moves forward, so the ready line is exact.
const upLines = async (dir: string, docker = fakeDocker(), buildSeconds = 48) => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00Z') });
  const lines: string[] = [];
  const run: Run = (command, args, options) => {
    if (command === 'npm') vi.setSystemTime(Date.now() + buildSeconds * 1000);
    return docker.run(command, args, options);
  };
  const result = await up({ dir, env: ENV, onLine: (line) => void lines.push(line) }, { run });
  return { lines, result };
};

afterEach(() => void vi.useRealTimers());

// C8, line for line.
const C8_UP = [
  'build    5 images from the release recipes            same recipe and tags as a release',
  'record   .agentage/record.json                        discovery valid',
  'store    postgres:18-alpine                           1 migration applied · 1 seed',
  'issuer   dev tokens                                   http://localhost:4281',
  'gateway  http://localhost:4280                        / · /ui/0.2.0/ · /api/v1/ · /mcp',
  'ready    7 parts healthy                              48 s',
];

describe('up', () => {
  it('builds, records, migrates, starts and prints the six lines of C8', async () => {
    const { lines, result } = await upLines(await probeDir());
    expect(result).toMatchObject({ parts: 7, seconds: 48 });
    expect(lines).toEqual(C8_UP);
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

  it('bounds compose up and the migrate job by their own timeouts, the rest by the default', async () => {
    const docker = fakeDocker();
    await up({ dir: await probeDir(), env: ENV }, { run: docker.run });
    const compose = docker.calls.filter((c) => c.args[1] === 'compose');
    // Unset is exec's TIMEOUTS.command.
    expect(compose.map((c) => c.options?.timeoutMs)).toEqual([
      TIMEOUTS.start,
      undefined,
      TIMEOUTS.migrate,
      TIMEOUTS.start,
      undefined,
    ]);
  });

  it('without a store or cli skips those steps', async () => {
    const { lines, result } = await upLines(await probeDir({ ...API_MANIFEST, scripts: {} }));
    expect(result.parts).toBe(1);
    expect(lines).toEqual([
      'build    1 image from the release recipes             same recipe and tags as a release',
      'record   .agentage/record.json                        discovery valid',
      'issuer   dev tokens                                   http://localhost:4281',
      'gateway  http://localhost:4280                        /api/v1/',
      'ready    1 part healthy                               0 s',
    ]);
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
      /^mcp is unhealthy\n$/
    );
  });

  it('says what a kept store already had, migrations and seeds', async () => {
    const migrate = '{"migrations":2,"applied":0,"seeds":0,"seedsBefore":1}\n';
    const { lines } = await upLines(await probeDir(), fakeDocker({}, { migrate }));
    expect(lines[2]).toBe(
      'store    postgres:18-alpine                           2 migrations already applied · 1 seed already applied'
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
    await expect(upLines(await probeDir(), docker)).rejects.toThrow(
      'the migrate job failed, no part was started: docker compose failed with exit code 1\nmigration 002-bad.sql failed: syntax error at or near "tabel"'
    );
    expect(docker.compose()).toEqual([
      'up -d store',
      'ps -a --format json',
      'run --rm --no-deps migrate',
    ]);
  });
});

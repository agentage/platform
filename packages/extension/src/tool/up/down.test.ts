import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../../test-support/packages.js';
import { type Run, type RunOptions } from '../exec.js';
import { down } from './down.js';
import { projectName } from './project.js';

const COMPOSE_LOG = [
  ...['api', 'mcp', 'pages', 'ui', 'worker', 'store'].flatMap((s) => [
    ` Container agentage-probe-${s}-1  Stopping`,
    ` Container agentage-probe-${s}-1  Removed`,
  ]),
  ' Network agentage-probe_default  Removing',
  ' Network agentage-probe_default  Removed',
  ' Volume agentage-probe_store  Removed',
].join('\n');

const fakeRun = (code = 0, stderr = COMPOSE_LOG) => {
  const calls: { args: string[]; options?: RunOptions }[] = [];
  const run: Run = async (command, args, options) => {
    calls.push({ args: [command, ...args], options });
    return { code, stdout: '', stderr };
  };
  return { run, calls };
};

const probe = () => tempPackage({ 'package.json': json(SPEC_MANIFEST) });

const rendered = async (dir: string, name: string) => {
  await mkdir(join(dir, '.agentage'));
  await writeFile(join(dir, '.agentage', 'compose.json'), json({ name, services: {} }));
};

const DOWN = ['--profile', 'jobs', 'down', '--remove-orphans'];

describe('down', () => {
  it("removes this working copy's project, store volume included, and names it", async () => {
    const dir = await probe();
    const project = projectName('probe', await realpath(dir));
    const { run, calls } = fakeRun();
    const lines: string[] = [];
    const result = await down({ dir, onLine: (line) => void lines.push(line) }, run);
    expect(result).toEqual({ project, containers: 6, networks: 1, volumes: 1 });
    expect(lines).toEqual([
      `removed  ${'6 containers · 1 network · 1 volume'.padEnd(45)}${project}`,
    ]);
    expect(calls).toEqual([
      {
        args: ['docker', 'compose', '-p', project, ...DOWN, '--volumes'],
        options: { quiet: true },
      },
    ]);
  });

  it('uses its own rendered compose file, and still removes the shared project of kit 0.2.0', async () => {
    const dir = await probe();
    const project = projectName('probe', await realpath(dir));
    await rendered(dir, project);
    const own = fakeRun();
    await down({ dir }, own.run);
    const file = join(await realpath(dir), '.agentage', 'compose.json');
    expect(own.calls[0]?.args.slice(0, 6)).toEqual([
      'docker',
      'compose',
      '-f',
      file,
      '-p',
      project,
    ]);
    await writeFile(file, json({ name: 'agentage-probe', services: {} }));
    const { run, calls } = fakeRun(0, ' Container agentage-probe-api-1  Removed\n');
    const lines: string[] = [];
    const result = await down({ dir, keepData: true, onLine: (l) => void lines.push(l) }, run);
    expect(result).toEqual({ project: 'agentage-probe', containers: 1, networks: 0, volumes: 0 });
    expect(lines).toEqual([
      'removed  1 container · 0 networks · 0 volumes (the store volume kept)  agentage-probe',
    ]);
    expect(calls[0]?.args).toEqual(['docker', 'compose', '-p', 'agentage-probe', ...DOWN]);
  });

  it('a copy made with cp -r ignores the compose file it carries: never the original project', async () => {
    const dir = await probe();
    await rendered(dir, 'agentage-probe-0a1b2c3d');
    const { run, calls } = fakeRun();
    const result = await down({ dir }, run);
    const own = projectName('probe', await realpath(dir));
    expect(result.project).toBe(own);
    expect(calls[0]?.args).toEqual(['docker', 'compose', '-p', own, ...DOWN, '--volumes']);
  });

  it('two working copies of one extension are two projects: down in one leaves the other', async () => {
    const [a, b] = [await probe(), await probe()];
    const first = fakeRun();
    const second = fakeRun();
    await down({ dir: a }, first.run);
    await down({ dir: b }, second.run);
    expect(first.calls[0]?.args[3]).not.toBe(second.calls[0]?.args[3]);
  });

  it('says so when nothing was running', async () => {
    const dir = await probe();
    const lines: string[] = [];
    await down({ dir, onLine: (l) => void lines.push(l) }, fakeRun(0, '').run);
    const project = projectName('probe', await realpath(dir));
    expect(lines).toEqual([`removed  ${'nothing was running'.padEnd(45)}${project}`]);
  });

  it('throws with the compose error when down fails', async () => {
    const { run } = fakeRun(1, 'Cannot connect to the Docker daemon\n');
    await expect(down({ dir: await probe() }, run)).rejects.toThrow(
      'docker compose down failed: Cannot connect to the Docker daemon'
    );
  });
});

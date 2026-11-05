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

  it('takes the project the rendered compose file names, so an older up is removed too', async () => {
    const dir = await probe();
    await rendered(dir, 'agentage-probe');
    const { run, calls } = fakeRun(0, ' Container agentage-probe-api-1  Removed\n');
    const lines: string[] = [];
    const result = await down({ dir, keepData: true, onLine: (l) => void lines.push(l) }, run);
    expect(result).toEqual({ project: 'agentage-probe', containers: 1, networks: 0, volumes: 0 });
    expect(lines[0]).toMatch(
      /^removed {2}1 container · 0 networks · 0 volumes \(the store volume kept\) +agentage-probe$/
    );
    const file = join(await realpath(dir), '.agentage', 'compose.json');
    expect(calls[0]?.args).toEqual([
      'docker',
      'compose',
      '-f',
      file,
      '-p',
      'agentage-probe',
      ...DOWN,
    ]);
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
    const lines: string[] = [];
    await down({ dir: await probe(), onLine: (l) => void lines.push(l) }, fakeRun(0, '').run);
    expect(lines[0]).toMatch(/^removed {2}nothing was running +agentage-probe-[0-9a-f]{8}$/);
  });

  it('throws with the compose error when down fails', async () => {
    const { run } = fakeRun(1, 'Cannot connect to the Docker daemon\n');
    await expect(down({ dir: await probe() }, run)).rejects.toThrow(
      'docker compose down failed: Cannot connect to the Docker daemon'
    );
  });
});

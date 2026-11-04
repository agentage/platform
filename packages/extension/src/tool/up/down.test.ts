import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../../test-support/packages.js';
import { type Run, type RunOptions } from '../exec.js';
import { down } from './down.js';

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

describe('down', () => {
  it('removes everything up started, store volume included, and counts it from compose', async () => {
    const dir = await probe();
    const { run, calls } = fakeRun();
    const lines: string[] = [];
    const result = await down({ dir, onLine: (line) => void lines.push(line) }, run);
    expect(result).toEqual({ containers: 6, networks: 1, volumes: 1 });
    expect(lines).toEqual(['removed  6 containers · 1 network · 1 volume']);
    expect(calls).toEqual([
      {
        args: [
          'docker',
          'compose',
          '-p',
          'agentage-probe',
          '--profile',
          'jobs',
          'down',
          '--remove-orphans',
          '--volumes',
        ],
        options: { quiet: true },
      },
    ]);
  });

  it('with keepData keeps the store volume, and uses the rendered compose file when there is one', async () => {
    const dir = await probe();
    await mkdir(join(dir, '.agentage'));
    await writeFile(join(dir, '.agentage', 'compose.json'), '{}');
    const { run, calls } = fakeRun(0, ' Container agentage-probe-api-1  Removed\n');
    const lines: string[] = [];
    expect(
      await down({ dir, keepData: true, onLine: (line) => void lines.push(line) }, run)
    ).toEqual({
      containers: 1,
      networks: 0,
      volumes: 0,
    });
    expect(lines).toEqual([
      'removed  1 container · 0 networks · 0 volumes (the store volume kept)',
    ]);
    expect(calls[0]?.args).toEqual([
      'docker',
      'compose',
      '-f',
      join(dir, '.agentage', 'compose.json'),
      '-p',
      'agentage-probe',
      '--profile',
      'jobs',
      'down',
      '--remove-orphans',
    ]);
  });

  it('throws with the compose error when down fails', async () => {
    const { run } = fakeRun(1, 'Cannot connect to the Docker daemon\n');
    await expect(down({ dir: await probe() }, run)).rejects.toThrow(
      'docker compose down failed: Cannot connect to the Docker daemon'
    );
  });
});

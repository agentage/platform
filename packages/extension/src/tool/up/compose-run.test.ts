import { describe, expect, it } from 'vitest';
import { type Run, type RunOptions } from '../exec.js';
import { compose, parsePs, states } from './compose-run.js';
import { plural, stepLine } from './lines.js';

describe('parsePs', () => {
  it('reads one object per line, or the one array of older releases', () => {
    const rows = [
      { Service: 'api', State: 'running', Health: 'healthy', ExitCode: 0 },
      { Service: 'migrate', State: 'exited', ExitCode: 1 },
    ];
    const expected = [
      { service: 'api', state: 'running', health: 'healthy', exitCode: 0 },
      { service: 'migrate', state: 'exited', health: '', exitCode: 1 },
    ];
    expect(parsePs(rows.map((row) => JSON.stringify(row)).join('\n'))).toEqual(expected);
    expect(parsePs(`${JSON.stringify(rows)}\n`)).toEqual(expected);
    expect(parsePs('  \n')).toEqual([]);
    expect(parsePs('{}')).toEqual([{ service: '', state: '', health: '', exitCode: 0 }]);
  });
});

describe('compose', () => {
  it('runs docker compose with the file and project, and states reads ps -a', async () => {
    const calls: string[][] = [];
    const run: Run = async (command, args, _options?: RunOptions) => {
      calls.push([command, ...args]);
      return { code: 0, stdout: '{"Service":"api","State":"running","Health":"healthy"}\n' };
    };
    await compose(run, { file: '/x/compose.json', project: 'agentage-probe' }, ['up', '-d']);
    await compose(run, { project: 'agentage-probe' }, ['down']);
    expect(await states(run, { project: 'p' })).toEqual([
      { service: 'api', state: 'running', health: 'healthy', exitCode: 0 },
    ]);
    expect(calls).toEqual([
      ['docker', 'compose', '-f', '/x/compose.json', '-p', 'agentage-probe', 'up', '-d'],
      ['docker', 'compose', '-p', 'agentage-probe', 'down'],
      ['docker', 'compose', '-p', 'p', 'ps', '-a', '--format', 'json'],
    ]);
  });

  it('throws with the stderr tail when compose fails', async () => {
    const run: Run = async () => ({ code: 1, stdout: '', stderr: 'no such service: nope\n' });
    await expect(compose(run, { project: 'p' }, ['up', 'nope'])).rejects.toThrow(
      'docker compose failed with exit code 1\nno such service: nope'
    );
  });
});

describe('lines', () => {
  it('lines up label, what and detail like a terminal table', () => {
    expect(stepLine('store', 'postgres:18-alpine', '1 migration')).toBe(
      `store    postgres:18-alpine${' '.repeat(27)}1 migration`
    );
    expect(stepLine('ready', '7 parts healthy')).toBe('ready    7 parts healthy');
    expect([plural(0, 'seed'), plural(1, 'seed'), plural(2, 'seed')]).toEqual([
      '0 seeds',
      '1 seed',
      '2 seeds',
    ]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Run } from '../exec.js';
import { waitHealthy } from './wait.js';

const TARGET = { project: 'agentage-probe' };

const ps = (rows: object[]) => rows.map((row) => JSON.stringify(row)).join('\n');

// Answers ps from a queue of snapshots (the last one repeats) and logs from a fixed text.
const fakeRun = (snapshots: object[][], logs: string | Error = 'line 1\nline 2\n') => {
  const calls: string[][] = [];
  const run: Run = async (_command, args) => {
    calls.push(args);
    if (args.includes('logs'))
      return logs instanceof Error ? { code: 1, stdout: '' } : { code: 0, stdout: logs };
    return {
      code: 0,
      stdout: ps(snapshots.length > 1 ? (snapshots.shift() ?? []) : (snapshots[0] ?? [])),
    };
  };
  return { run, calls };
};

const healthy = (service: string) => ({ Service: service, State: 'running', Health: 'healthy' });
const starting = (service: string) => ({ Service: service, State: 'running', Health: 'starting' });

afterEach(() => void vi.useRealTimers());

describe('waitHealthy', () => {
  it('polls once a second until every named service is healthy', async () => {
    const sleeps: number[] = [];
    const { run } = fakeRun([
      [starting('api')],
      [healthy('api')],
      [healthy('api'), starting('other')],
    ]);
    const sleep = async (ms: number) => void sleeps.push(ms);
    await waitHealthy(TARGET, ['api'], { run, sleep });
    expect(sleeps).toEqual([1000]);
  });

  it('fails at the first broken service with the tail of its log', async () => {
    const { run, calls } = fakeRun([
      [healthy('store'), { Service: 'api', State: 'running', Health: 'unhealthy' }],
    ]);
    await expect(waitHealthy(TARGET, ['store', 'api'], { run })).rejects.toThrow(
      'api is unhealthy\nline 1\nline 2'
    );
    expect(calls.at(-1)).toEqual([
      'compose',
      '-p',
      'agentage-probe',
      'logs',
      '--no-color',
      '--tail',
      '20',
      'api',
    ]);
    const exited = fakeRun(
      [[{ Service: 'migrate', State: 'exited', ExitCode: 1 }]],
      new Error('gone')
    );
    await expect(waitHealthy(TARGET, ['migrate'], { run: exited.run })).rejects.toThrow(
      /^migrate is exited\n$/
    );
    const dead = fakeRun([[{ Service: 'api', State: 'dead' }]]);
    await expect(waitHealthy(TARGET, ['api'], { run: dead.run })).rejects.toThrow(/^api is dead/);
  });

  it('gives up after the timeout and names the services still waiting', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-05T10:00:00Z') });
    const { run, calls } = fakeRun([[healthy('store'), starting('api')]]);
    const sleep = async (ms: number) => void vi.advanceTimersByTime(ms);
    await expect(
      waitHealthy(TARGET, ['store', 'api', 'mcp'], { run, sleep, timeoutMs: 3000 })
    ).rejects.toThrow('not healthy after 3 s: api, mcp');
    // Polls at 0, 1, 2, 3 and 4 s: the first past the deadline gives up.
    expect(calls).toHaveLength(5);
    const slow = fakeRun([[starting('api')]]);
    await expect(waitHealthy(TARGET, ['api'], { run: slow.run, sleep })).rejects.toThrow(
      'not healthy after 180 s: api'
    );
    expect(slow.calls).toHaveLength(182);
  });
});

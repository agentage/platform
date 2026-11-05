import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedLog, type RecordedLog } from '../test-support/http.js';
import { runLog } from './run-log.js';
import { memoryRuns } from './runs.js';
import { createScheduler, type Scheduler } from './scheduler.js';

let logged: RecordedLog;
let runs: ReturnType<typeof memoryRuns>;
let scheduler: Scheduler;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T10:00:30Z') });
  logged = recordedLog();
  runs = memoryRuns();
  scheduler = createScheduler({ runs, log: runLog(logged.log) });
});
afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

const skipped = () =>
  logged.lines.filter((line) => line['msg'] === 'job skipped: its previous run is still running');

describe('scheduler', () => {
  it('never runs a job twice at once: a tick during a run is skipped with a warn', async () => {
    let release = (): void => undefined;
    const job = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    scheduler.schedule('tick', '* * * * *', job);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job).toHaveBeenCalledTimes(1);
    expect(skipped()).toEqual([expect.objectContaining({ level: 'warn', job: 'tick' })]);
    expect(await scheduler.run('tick')).toBeUndefined();
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job).toHaveBeenCalledTimes(2);
    expect(runs.all('tick').map((run) => run.status)).toEqual(['ok']);
  });

  it('a run that skips a tick, or runs past its timeout, reads degraded until the next run', async () => {
    const releases: (() => void)[] = [];
    const hang = () => new Promise<void>((resolve) => void releases.push(resolve));
    scheduler.schedule('tick', '* * * * *', hang);
    scheduler.schedule('slow', '* * * * *', hang, { timeout: '20s' });
    const check = (name: string) => scheduler.checks()[`job:${name}`]?.();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect([await check('tick'), await check('slow')]).toEqual(['ok', 'ok']);
    await vi.advanceTimersByTimeAsync(21_000);
    expect([await check('tick'), await check('slow')]).toEqual(['ok', 'degraded']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await check('tick')).toBe('degraded');
    for (const release of releases) release();
    await vi.advanceTimersByTimeAsync(0);
    expect([await check('tick'), await check('slow')]).toEqual(['ok', 'ok']);
  });

  it('saves every run with the log the job wrote through ctx.log', async () => {
    const log = runLog(logged.log);
    scheduler.schedule('tick', '* * * * *', async () => {
      log.info('tick 1\nsecond line');
      log.warn('slow');
    });
    const run = await scheduler.run('tick');
    expect(run).toMatchObject({
      job: 'tick',
      status: 'ok',
      log: 'info tick 1\nsecond line\nwarn slow\n',
    });
    expect(run?.startedAt).toEqual(new Date('2026-11-05T10:00:30Z'));
    expect(runs.all('tick')).toEqual([run]);
    expect(logged.lines.map((line) => line['msg'])).toEqual(['tick 1\nsecond line', 'slow']);
    expect(await scheduler.run('nope')).toBeUndefined();
  });

  it('records a failed run with its error, and the job check goes degraded until an ok run', async () => {
    let fails = true;
    scheduler.schedule('tick', '* * * * *', () => {
      if (fails) throw new Error('boom');
    });
    const check = scheduler.checks()['job:tick'];
    expect(await check?.()).toBe('ok');
    expect(await scheduler.run('tick')).toMatchObject({ status: 'failed', log: 'error boom\n' });
    expect(logged.lines.at(-1)).toMatchObject({ level: 'error', msg: 'boom', job: 'tick' });
    expect(await check?.()).toBe('degraded');
    fails = false;
    await scheduler.run('tick');
    expect(await check?.()).toBe('ok');
  });

  it('records the timeout without enforcing it', async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 90_000));
    scheduler.schedule('slow', '0 * * * *', slow, { timeout: '30s' });
    const pending = scheduler.run('slow');
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await pending).toMatchObject({ status: 'ok', timeoutMs: 30_000 });
    scheduler.schedule('ms', '* * * * *', () => undefined, { timeout: 500 });
    scheduler.schedule('min', '* * * * *', () => undefined, { timeout: '5m' });
    scheduler.schedule('hour', '* * * * *', () => undefined, { timeout: '1h' });
    expect((await scheduler.run('ms'))?.timeoutMs).toBe(500);
    expect((await scheduler.run('min'))?.timeoutMs).toBe(300_000);
    expect((await scheduler.run('hour'))?.timeoutMs).toBe(3_600_000);
  });

  it('logs a failed save and goes on', async () => {
    const failing = {
      save: async () => Promise.reject(new Error('store down')),
      last: async () => undefined,
    };
    const s = createScheduler({ runs: failing, log: logged.log });
    s.schedule('tick', '* * * * *', () => undefined);
    expect(await s.run('tick')).toMatchObject({ status: 'ok' });
    expect(logged.lines.at(-1)).toMatchObject({ level: 'error', msg: 'store down', job: 'tick' });
  });

  it('refuses a duplicate name, a bad name, a bad cron and unknown options', () => {
    scheduler.schedule('tick', '* * * * *', () => undefined);
    expect(() => scheduler.schedule('tick', '* * * * *', () => undefined)).toThrow(
      'job tick is scheduled twice'
    );
    expect(() => scheduler.schedule('Tick_1', '* * * * *', () => undefined)).toThrow(/lowercase/);
    expect(() => scheduler.schedule('x'.repeat(49), '* * * * *', () => undefined)).toThrow();
    expect(() => scheduler.schedule('bad', '* * *', () => undefined)).toThrow(/five fields/);
    expect(() =>
      scheduler.schedule('soon', '* * * * *', () => undefined, { timeout: 'soon' })
    ).toThrow(/duration/);
    const extra = { timeout: 5, retries: 3 } as unknown as { timeout: number };
    expect(() => scheduler.schedule('extra', '* * * * *', () => undefined, extra)).toThrow();
  });
});

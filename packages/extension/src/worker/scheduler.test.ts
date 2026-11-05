import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
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

// The message a refused schedule throws, or 'scheduled'.
// A Zod refusal reads as its issues (path, code, message), never as Zod's own JSON layout.
const refusal = (name: string, cron = '* * * * *', options?: object): string => {
  try {
    scheduler.schedule(name, cron, () => undefined, options);
    return 'scheduled';
  } catch (err) {
    if (!(err instanceof ZodError)) return (err as Error).message;
    return err.issues.map((i) => `${i.path.join('.')} ${i.code}: ${i.message}`).join('; ');
  }
};

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

  it('degraded while a run skips a tick or outlives its timeout, ok once it ends', async () => {
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
      vi.advanceTimersByTime(1_500);
      log.warn('slow');
    });
    const run = await scheduler.run('tick');
    expect(runs.all('tick')).toEqual([
      {
        job: 'tick',
        startedAt: new Date('2026-11-05T10:00:30Z'),
        endedAt: new Date('2026-11-05T10:00:31.500Z'),
        status: 'ok',
        log: 'info tick 1\nsecond line\nwarn slow\n',
      },
    ]);
    expect(runs.all('tick')[0]).toBe(run);
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
    scheduler.schedule('ms-text', '* * * * *', () => undefined, { timeout: '250ms' });
    scheduler.schedule('min', '* * * * *', () => undefined, { timeout: '5m' });
    scheduler.schedule('hour', '* * * * *', () => undefined, { timeout: '1h' });
    expect((await scheduler.run('ms'))?.timeoutMs).toBe(500);
    expect((await scheduler.run('ms-text'))?.timeoutMs).toBe(250);
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
    expect(refusal('tick')).toBe('job tick is scheduled twice');
    expect(refusal('Tick_1')).toBe(' invalid_format: job names are lowercase, digits and dashes');
    expect(refusal('x'.repeat(49))).toMatch(/^ too_big: /);
    expect(refusal('x'.repeat(48))).toBe('scheduled');
    expect(refusal('bad', '* * *')).toBe('cron "* * *": five fields expected');
    expect(refusal('soon', '* * * * *', { timeout: 'soon' })).toBe(
      'timeout invalid_format: a duration like 500ms, 30s, 5m or 1h'
    );
    expect(refusal('extra', '* * * * *', { timeout: 5, retries: 3 })).toMatch(
      /^ unrecognized_keys: .*retries/
    );
    expect(Object.keys(scheduler.checks())).toEqual(['job:tick', `job:${'x'.repeat(48)}`]);
  });
});

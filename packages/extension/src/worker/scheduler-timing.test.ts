import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { memoryRuns } from './runs.js';
import { createScheduler, LATE_MS } from './scheduler.js';

beforeEach(() => void vi.useFakeTimers({ now: new Date('2026-11-05T10:00:30Z') }));
afterEach(() => void vi.useRealTimers());

describe('scheduler timing', () => {
  it('a job whose timer is overdue by more than a minute is degraded', async () => {
    let clock = new Date('2026-11-05T10:00:30Z');
    const s = createScheduler({ runs: memoryRuns(), log: recordedLog().log, now: () => clock });
    s.schedule('tick', '* * * * *', () => undefined);
    const check = s.checks()['job:tick'];
    expect(await check?.()).toBe('ok');
    clock = new Date(new Date('2026-11-05T10:01:00Z').getTime() + LATE_MS);
    expect(await check?.()).toBe('ok');
    clock = new Date(clock.getTime() + 1);
    expect(await check?.()).toBe('degraded');
  });

  it('stops, catches up once on a restart, and arms a job scheduled after the start', async () => {
    const runs = memoryRuns();
    const s = createScheduler({ runs, log: recordedLog().log });
    s.start();
    const job = vi.fn();
    s.schedule('late-add', '* * * * *', job);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(job).toHaveBeenCalledTimes(1);
    s.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(job).toHaveBeenCalledTimes(1);
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(job).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job).toHaveBeenCalledTimes(3);
    expect(runs.all('late-add')).toHaveLength(3);
    s.stop();
  });

  it('re-arms a timer that fires before the next run, past the 24.8 day timer limit', async () => {
    const s = createScheduler({ runs: memoryRuns(), log: recordedLog().log });
    const job = vi.fn();
    s.schedule('yearly', '0 0 1 1 *', job);
    s.start();
    await vi.advanceTimersByTimeAsync(2 ** 31 - 1);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(Date.parse('2027-01-01T00:00:00Z') - Date.now());
    expect(job).toHaveBeenCalledTimes(1);
    s.stop();
  });
});

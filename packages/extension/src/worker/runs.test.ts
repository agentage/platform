import { afterEach, describe, expect, it } from 'vitest';
import { createTestStore, type TestStore } from '../store/test-store.js';
import { KEEP_RUNS, memoryRuns, storeRuns, type JobRun } from './runs.js';

const runOf = (job: string, n: number, extra: Partial<JobRun> = {}): JobRun => ({
  job,
  startedAt: new Date(Date.UTC(2026, 10, 5, 10, 0, n)),
  endedAt: new Date(Date.UTC(2026, 10, 5, 10, 0, n + 1)),
  status: 'ok',
  log: `info run ${n}\n`,
  ...extra,
});

let store: TestStore | undefined;
afterEach(async () => store?.close());

describe('memoryRuns', () => {
  it('keeps the last 50 runs per job', async () => {
    const runs = memoryRuns();
    for (let n = 0; n < KEEP_RUNS + 5; n += 1) await runs.save(runOf('tick', n));
    await runs.save(runOf('other', 0));
    expect(runs.all('tick')).toHaveLength(50);
    expect(runs.all('tick')[0]?.log).toBe('info run 5\n');
    expect((await runs.last('tick'))?.log).toBe('info run 54\n');
    expect(runs.all('other')).toHaveLength(1);
    expect(await runs.last('none')).toBeUndefined();
  });
});

describe('storeRuns', () => {
  it('saves runs into agentage_job_runs and prunes to the last 50 per job', async () => {
    store = createTestStore(async () => undefined);
    const runs = storeRuns(store);
    expect(await runs.last('tick')).toBeUndefined();
    for (let n = 0; n < KEEP_RUNS + 3; n += 1) await runs.save(runOf('tick', n));
    await runs.save(runOf('other', 0, { status: 'failed', timeoutMs: 30_000 }));
    const counts = await store.query<{ job: string; n: number }>(
      'select job, count(*)::int as n from agentage_job_runs group by job order by job'
    );
    expect(counts.rows).toEqual([
      { job: 'other', n: 1 },
      { job: 'tick', n: 50 },
    ]);
    expect(await runs.last('tick')).toEqual(runOf('tick', 52));
    expect(await runs.last('other')).toEqual(
      runOf('other', 0, { status: 'failed', timeoutMs: 30_000 })
    );
  });
});

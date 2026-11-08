import { afterAll, describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { createTestStore } from '../store/test-store.js';
import { storeRuns } from './runs.js';
import { createScheduler } from './scheduler.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('a job run carries an agcid', () => {
  const store = createTestStore(async () => undefined);
  afterAll(() => store.close());

  it('shares one fresh agcid between its log lines and the saved run', async () => {
    const { log, lines } = recordedLog();
    const runs = storeRuns(store);
    const scheduler = createScheduler({ runs, log });
    scheduler.schedule('tick', '* * * * *', () => log.info('working'));
    scheduler.schedule('crash', '* * * * *', () => {
      throw new Error('broke');
    });
    await scheduler.run('tick');
    await scheduler.run('tick');
    const saved = await runs.last('tick');
    expect(saved?.agcid).toMatch(UUID_V7);
    expect(lines.map((line) => line['agcid'])).toEqual([lines[0]?.['agcid'], saved?.agcid]);
    expect(lines[0]?.['agcid']).not.toBe(saved?.agcid);
    await scheduler.run('crash');
    expect(lines.at(-1)?.['agcid']).toBe((await runs.last('crash'))?.agcid);
  });

  it('reads a run saved before the column existed without an agcid', async () => {
    await store.query(
      `insert into agentage_job_runs (job, started_at, ended_at, status, log)
       values ('old', now(), now(), 'ok', '')`
    );
    expect(await storeRuns(store).last('old')).not.toHaveProperty('agcid');
  });
});

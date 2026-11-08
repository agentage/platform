import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { tempPackage } from '../test-support/packages.js';
import { migrate } from './migrations.js';
import { createTestStore, type TestStore } from './test-store.js';

// The table as a pre-0.7 worker created it lazily, without agcid, holding one run.
const LAZY = `create table agentage_job_runs (id bigint generated always as identity primary key,
  job text not null, started_at timestamptz not null, ended_at timestamptz not null,
  status text not null, log text not null, timeout_ms integer);
insert into agentage_job_runs (job, started_at, ended_at, status, log)
  values ('tick', now(), now(), 'ok', '')`;

const COLUMNS = `select column_name from information_schema.columns
  where table_name = 'agentage_job_runs' order by ordinal_position`;

let store: TestStore;
beforeEach(async () => {
  store = createTestStore(async () => undefined);
  await store.query('select 1');
});
afterEach(() => store.close());

const ledger = async () =>
  (await store.query<{ name: string }>('select name from _migrations order by name')).rows;

describe('the kit migration', () => {
  it('creates agentage_job_runs with agcid before the first extension file, once', async () => {
    const dir = await tempPackage({
      'migrations/001-runs-view.sql':
        'create view runs as select job, agcid from agentage_job_runs;',
    });
    expect((await migrate(store, dir, recordedLog().log)).applied).toBe(1);
    expect(await ledger()).toEqual([{ name: '001-runs-view.sql' }, { name: 'kit:001-job-runs' }]);
    expect((await store.query(COLUMNS)).rows.at(-1)).toEqual({ column_name: 'agcid' });
    expect((await migrate(store, dir, recordedLog().log)).applied).toBe(0);
  });

  it('adds agcid to the lazy table of an older kit and keeps its runs', async () => {
    await store.query(LAZY);
    await migrate(store, await tempPackage({}), recordedLog().log);
    const { rows } = await store.query('select job, agcid from agentage_job_runs');
    expect(rows).toEqual([{ job: 'tick', agcid: null }]);
  });

  it('still seeds a store whose ledger holds only kit rows', async () => {
    await migrate(store, await tempPackage({}), recordedLog().log);
    const later = await tempPackage({
      'migrations/001-ticks.sql': 'create table ticks (job text);',
      'seeds/001-hello.sql': "insert into ticks values ('seed');",
    });
    expect((await migrate(store, later, recordedLog().log)).seeds).toBe(1);
  });
});

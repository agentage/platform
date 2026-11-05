import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { tempPackage } from '../test-support/packages.js';
import { RUNS_TABLE } from '../worker/runs.js';
import { migrate, sqlFiles } from './migrations.js';
import { createTestStore, type TestStore } from './test-store.js';

const TICKS = 'create table ticks (id int generated always as identity primary key, job text);';
const HELLO = "insert into ticks (job) values ('seed');";

// A fresh in-process postgres per test, booted here so no test pays the WASM start.
let store: TestStore;
beforeEach(async () => {
  store = createTestStore(async () => undefined);
  await store.query('select 1');
});
afterEach(() => store.close());

const names = async (s: TestStore) =>
  (await s.query<{ name: string }>('select name from _migrations order by name')).rows.map(
    (row) => row.name
  );

describe('migrate', () => {
  it('applies migrations in file order, records them, seeds an empty store once', async () => {
    const dir = await tempPackage({
      'migrations/002-seed-col.sql': "alter table ticks add column note text default 'x';",
      'migrations/001-ticks.sql': TICKS,
      'seeds/001-hello.sql': HELLO,
    });
    const s = store;
    const { log, lines } = recordedLog();
    expect(await migrate(s, dir, log)).toEqual({
      migrations: 2,
      applied: 2,
      seeds: 1,
      seedsBefore: 0,
    });
    expect(await names(s)).toEqual(['001-ticks.sql', '002-seed-col.sql', 'seed:001-hello.sql']);
    expect((await s.query('select job, note from ticks')).rows).toEqual([
      { job: 'seed', note: 'x' },
    ]);
    expect(lines[0]).toMatchObject({ msg: 'migrated', migrations: 2, applied: 2, seeds: 1 });
    expect(await migrate(s, dir, log)).toEqual({
      migrations: 2,
      applied: 0,
      seeds: 0,
      seedsBefore: 1,
    });
    expect((await s.query('select count(*)::int as n from ticks')).rows).toEqual([{ n: 1 }]);
  });

  it('applies a file added later, never seeding a store with a ledger row, even with no table', async () => {
    const s = store;
    const { log } = recordedLog();
    await migrate(s, await tempPackage({ 'migrations/001-schema.sql': 'create schema app;' }), log);
    const later = await tempPackage({
      'migrations/001-schema.sql': 'create schema app;',
      'migrations/002-ticks.sql': TICKS,
      'seeds/001-hello.sql': HELLO,
    });
    expect(await migrate(s, later, log)).toEqual({
      migrations: 2,
      applied: 1,
      seeds: 0,
      seedsBefore: 0,
    });
    expect(await names(s)).toEqual(['001-schema.sql', '002-ticks.sql']);
  });

  it("seeds a store whose only table is the kit's own", async () => {
    const dir = await tempPackage({
      'migrations/001-ticks.sql': TICKS,
      'seeds/001-hello.sql': HELLO,
    });
    const s = store;
    await s.query(RUNS_TABLE);
    expect((await migrate(s, dir, recordedLog().log)).seeds).toBe(1);
  });

  it('never seeds a store that already holds tables, even with no ledger (a restored dump)', async () => {
    const dir = await tempPackage({
      'migrations/001-ticks.sql': TICKS,
      'seeds/001-hello.sql': HELLO,
    });
    const s = store;
    await s.query('create table notes (id int); insert into notes values (1);');
    expect(await migrate(s, dir, recordedLog().log)).toEqual({
      migrations: 1,
      applied: 1,
      seeds: 0,
      seedsBefore: 0,
    });
    expect(await names(s)).toEqual(['001-ticks.sql']);
  });

  it('takes missing folders as empty', async () => {
    const dir = await tempPackage({ 'package.json': '{}' });
    const s = store;
    expect(await migrate(s, dir, recordedLog().log)).toEqual({
      migrations: 0,
      applied: 0,
      seeds: 0,
      seedsBefore: 0,
    });
  });

  it('names a failing file, rolls it back and leaves it unrecorded', async () => {
    const dir = await tempPackage({
      'migrations/001-ticks.sql': TICKS,
      'migrations/002-bad.sql': 'create table half (id int);\ninsert into nope values (1);',
    });
    const s = store;
    await expect(migrate(s, dir, recordedLog().log)).rejects.toThrow(
      /^migration 002-bad\.sql failed: relation "nope" does not exist$/
    );
    expect(await names(s)).toEqual(['001-ticks.sql', 'seeds:owed']);
    const half =
      "select count(*)::int as n from information_schema.tables where table_name = 'half'";
    expect((await s.query(half)).rows).toEqual([{ n: 0 }]);
  });

  it('a fresh store whose first run failed still gets its seeds once the fix lands', async () => {
    const files = {
      'migrations/001-ticks.sql': TICKS,
      'seeds/001-hello.sql': HELLO,
    };
    const broken = await tempPackage({ ...files, 'migrations/002-more.sql': 'create tabel x;' });
    const s = store;
    const { log } = recordedLog();
    await expect(migrate(s, broken, log)).rejects.toThrow(/migration 002-more\.sql failed/);
    const fixed = await tempPackage({ ...files, 'migrations/002-more.sql': 'create table x ();' });
    expect(await migrate(s, fixed, log)).toEqual({
      migrations: 2,
      applied: 1,
      seeds: 1,
      seedsBefore: 0,
    });
    expect(await names(s)).toEqual(['001-ticks.sql', '002-more.sql', 'seed:001-hello.sql']);
    expect((await migrate(s, fixed, log)).seeds).toBe(0);
  });

  it('names a failing seed and keeps it owed', async () => {
    const dir = await tempPackage({
      'migrations/001-ticks.sql': TICKS,
      'seeds/001-bad.sql': 'insert into nope values (1);',
    });
    const s = store;
    await expect(migrate(s, dir, recordedLog().log)).rejects.toThrow(
      /^seed 001-bad\.sql failed: relation "nope" does not exist/
    );
    expect(await names(s)).toEqual(['001-ticks.sql', 'seeds:owed']);
  });
});

describe('sqlFiles', () => {
  it('refuses a file not named NNN-name.sql, so a typo never skips silently', async () => {
    const dir = await tempPackage({
      'migrations/001-ok.sql': '',
      'migrations/2-bad.sql': '',
      'migrations/003-Upper.sql': '',
    });
    await expect(sqlFiles(`${dir}/migrations`)).rejects.toThrow(
      /not NNN-name\.sql: 003-Upper\.sql, 2-bad\.sql|not NNN-name\.sql: 2-bad\.sql, 003-Upper\.sql/
    );
  });

  it('is empty for a missing folder and throws any other read error', async () => {
    const dir = await tempPackage({ 'migrations.sql': '' });
    expect(await sqlFiles(`${dir}/migrations`)).toEqual([]);
    await expect(sqlFiles(`${dir}/migrations.sql`)).rejects.toThrow(/ENOTDIR/);
  });
});

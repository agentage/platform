import { afterEach, describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { tempPackage } from '../test-support/packages.js';
import { migrate, sqlFiles } from './migrations.js';
import { createTestStore, type TestStore } from './test-store.js';

const TICKS = 'create table ticks (id int generated always as identity primary key, job text);';

let store: TestStore | undefined;
afterEach(async () => {
  await store?.close();
  store = undefined;
});

const openStore = (): TestStore => (store = createTestStore(async () => undefined));

const names = async (s: TestStore) =>
  (await s.query<{ name: string }>('select name from _migrations order by name')).rows.map(
    (row) => row.name
  );

describe('migrate', () => {
  it('applies migrations in file order, records them, seeds an empty store once', async () => {
    const dir = await tempPackage({
      'migrations/002-seed-col.sql': "alter table ticks add column note text default 'x';",
      'migrations/001-ticks.sql': TICKS,
      'seeds/001-hello.sql': "insert into ticks (job) values ('seed');",
    });
    const s = openStore();
    const { log, lines } = recordedLog();
    expect(await migrate(s, dir, log)).toEqual({ migrations: 2, applied: 2, seeds: 1 });
    expect(await names(s)).toEqual(['001-ticks.sql', '002-seed-col.sql', 'seed:001-hello.sql']);
    expect((await s.query('select job, note from ticks')).rows).toEqual([
      { job: 'seed', note: 'x' },
    ]);
    expect(lines[0]).toMatchObject({ msg: 'migrated', migrations: 2, applied: 2, seeds: 1 });
    expect(await migrate(s, dir, log)).toEqual({ migrations: 2, applied: 0, seeds: 0 });
    expect((await s.query('select count(*)::int as n from ticks')).rows).toEqual([{ n: 1 }]);
  });

  it('applies a new file later, but never seeds a store that already has rows', async () => {
    const dir = await tempPackage({ 'migrations/001-ticks.sql': TICKS });
    const s = openStore();
    const { log } = recordedLog();
    await migrate(s, dir, log);
    const later = await tempPackage({
      'migrations/001-ticks.sql': TICKS,
      'migrations/002-more.sql': 'create table more (id int);',
      'seeds/001-hello.sql': "insert into ticks (job) values ('seed');",
    });
    expect(await migrate(s, later, log)).toEqual({ migrations: 2, applied: 1, seeds: 0 });
  });

  it('takes missing folders as empty', async () => {
    const dir = await tempPackage({ 'package.json': '{}' });
    const s = openStore();
    expect(await migrate(s, dir, recordedLog().log)).toEqual({
      migrations: 0,
      applied: 0,
      seeds: 0,
    });
  });

  it('throws on a failing file and leaves it unrecorded', async () => {
    const dir = await tempPackage({
      'migrations/001-ticks.sql': TICKS,
      'migrations/002-broken.sql': 'create tabel nope (id int);',
    });
    const s = openStore();
    await expect(migrate(s, dir, recordedLog().log)).rejects.toThrow(/syntax error/);
    expect(await names(s)).toEqual(['001-ticks.sql']);
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

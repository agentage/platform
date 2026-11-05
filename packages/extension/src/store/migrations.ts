import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf, type Log } from '../log/log.js';
import { type Store } from './store.types.js';

export const SQL_FILE = /^[0-9]{3}-[a-z0-9-]+\.sql$/;

export interface MigrateResult {
  migrations: number;
  applied: number;
  seeds: number;
  // Seed files a run before this one applied: `up` says "already applied" on a kept store.
  seedsBefore: number;
}

// Filename order; anything else in the folder is refused, so a typo never silently skips a file.
export const sqlFiles = async (dir: string): Promise<string[]> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const bad = names.filter((name) => !SQL_FILE.test(name));
  if (bad.length > 0) throw new Error(`${dir}: not NNN-name.sql: ${bad.join(', ')}`);
  return names.sort();
};

const LEDGER = `create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`;

const SEED = 'seed:';
// Written by the first run on an empty store, removed once the seeds ran: a failed first run still seeds later.
export const SEEDS_OWED = 'seeds:owed';

const appliedNames = async (store: Store): Promise<Set<string>> => {
  await store.query(LEDGER);
  const { rows } = await store.query<{ name: string }>('select name from _migrations');
  return new Set(rows.map((row) => row.name));
};

// One string, one round trip: the file and its ledger row commit together or not at all.
const applyFile = async (store: Store, file: string, name: string): Promise<void> => {
  const sql = await readFile(file, 'utf8');
  try {
    await store.query(
      `begin;\n${sql}\n;insert into _migrations (name) values ('${name}');\ncommit;`
    );
  } catch (err) {
    await store.query('rollback').catch(() => undefined);
    const kind = name.startsWith(SEED) ? 'seed' : 'migration';
    throw new Error(`${kind} ${name.replace(SEED, '')} failed: ${messageOf(err)}`, { cause: err });
  }
};

const applyAll = async (store: Store, dir: string, prefix: string, done: Set<string>) => {
  let count = 0;
  for (const file of await sqlFiles(dir)) {
    const name = `${prefix}${file}`;
    if (done.has(name)) continue;
    await applyFile(store, join(dir, file), name);
    count += 1;
  }
  return count;
};

const seedOnce = async (store: Store, dir: string, done: Set<string>): Promise<number> => {
  const seeds = await applyAll(store, join(dir, 'seeds'), SEED, done);
  await store.query(`delete from _migrations where name = '${SEEDS_OWED}'`);
  return seeds;
};

// Migrations in order, each once; seeds once, only on a store that had no ledger row before.
export const migrate = async (store: Store, dir: string, log: Log): Promise<MigrateResult> => {
  const done = await appliedNames(store);
  const owed = done.size === 0 || done.has(SEEDS_OWED);
  if (done.size === 0) await store.query(`insert into _migrations (name) values ('${SEEDS_OWED}')`);
  const migrations = (await sqlFiles(join(dir, 'migrations'))).length;
  const applied = await applyAll(store, join(dir, 'migrations'), '', done);
  const seeds = owed ? await seedOnce(store, dir, done) : 0;
  const seedsBefore = [...done].filter((name) => name.startsWith(SEED)).length;
  const result = { migrations, applied, seeds, seedsBefore };
  log.info('migrated', { ...result });
  return result;
};

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { createTestStore, type TestStore } from './test-store.js';

const pool = vi.hoisted(() => ({
  store: undefined as TestStore | undefined,
  ended: 0,
  opened: [] as unknown[],
}));

// The entry builds a pg pool from env; here that pool is an in-process store, booted in a hook.
vi.mock('./store.js', () => ({
  createStore: (_env: unknown, _log: unknown, timeouts: unknown) => {
    pool.opened.push(timeouts);
    return { query: pool.store?.query, end: async () => void (pool.ended += 1) };
  },
}));

const run = async (dir: string) => {
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.resetModules();
  await import('./migrate.js');
};

let stdout: string[];
let stderr: string[];
beforeEach(async () => {
  pool.store = createTestStore(async () => undefined);
  await pool.store.query('select 1');
  Object.assign(pool, { ended: 0, opened: [] });
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => stdout.push(String(text)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((text) => stderr.push(String(text)) > 0);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await pool.store?.close();
});

describe('the migrate entry', () => {
  it('migrates the package in the working folder and prints the summary', async () => {
    const dir = await tempPackage({
      'package.json': json(SPEC_MANIFEST),
      'migrations/001-ticks.sql': 'create table ticks (id int);',
      'seeds/001-hello.sql': 'insert into ticks values (1);',
    });
    await run(dir);
    expect(stdout).toEqual(['{"migrations":1,"applied":1,"seeds":1,"seedsBefore":0}\n']);
    expect(pool.opened).toEqual([{ connectMs: 10_000, statementMs: 300_000 }]);
    expect(pool.ended).toBe(1);
  });

  it('exits 1 on a bad migration, the log naming the file, and prints no summary', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const dir = await tempPackage({
      'package.json': json(SPEC_MANIFEST),
      'migrations/001-ticks.sql': 'create tabel ticks (id int);',
    });
    await run(dir);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr.join(''))).toMatchObject({
      level: 'error',
      'extension.id': 'probe',
      msg: expect.stringMatching(/^migration 001-ticks\.sql failed: syntax error/),
    });
  });

  it('logs the error and exits 1 when the package is not an extension', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await run(await tempPackage({ 'package.json': json({ name: 'x' }) }));
    expect(exit).toHaveBeenCalledWith(1);
    expect(stdout).toEqual([]);
    expect(pool.opened).toEqual([]);
    expect(JSON.parse(stderr.join(''))).toMatchObject({
      level: 'error',
      'extension.id': 'unknown',
      'extension.part': 'migrate',
      msg: expect.stringMatching(/^invalid agentage manifest in package\.json: version: /),
    });
  });
});

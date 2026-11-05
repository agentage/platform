import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';

const ended = vi.hoisted(() => ({ count: 0 }));

// The entry builds a pg pool from env; here that pool is an in-process store.
vi.mock('./store.js', async () => {
  const { createTestStore } = await import('./test-store.js');
  return {
    createStore: () => {
      const store = createTestStore(async () => undefined);
      return { query: store.query, end: async () => (ended.count++, store.close()) };
    },
  };
});

const run = async (dir: string) => {
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.resetModules();
  await import('./migrate.js');
};

let stdout: string[];
let stderr: string[];
beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => stdout.push(String(text)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((text) => stderr.push(String(text)) > 0);
});
afterEach(() => vi.restoreAllMocks());

describe('the migrate entry', () => {
  it('migrates the package in the working folder and prints the summary', async () => {
    const dir = await tempPackage({
      'package.json': json(SPEC_MANIFEST),
      'migrations/001-ticks.sql': 'create table ticks (id int);',
      'seeds/001-hello.sql': 'insert into ticks values (1);',
    });
    await run(dir);
    expect(stdout).toEqual(['{"migrations":1,"applied":1,"seeds":1,"seedsBefore":0}\n']);
    expect(ended.count).toBe(1);
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
      extension: 'probe',
      msg: expect.stringMatching(/^migration 001-ticks\.sql failed: syntax error/),
    });
  });

  it('logs the error and exits 1 when the package is not an extension', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await run(await tempPackage({ 'package.json': json({ name: 'x' }) }));
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(stderr.join(''))).toMatchObject({ level: 'error', part: 'migrate' });
  });
});

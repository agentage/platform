import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { tempPackage } from '../test-support/packages.js';
import { isFailure } from '../envelope/envelope.js';
import { createStore, isOutage, storeCheck, storeUrl } from './store.js';
import { createTestStore, type TestStore } from './test-store.js';
import { type Store } from './store.types.js';

describe('storeUrl', () => {
  it('reads AGENTAGE_STORE_URL, a _FILE secret over it, else undefined for libpq env', async () => {
    const url = 'postgres://probe:pw@store:5432/probe';
    expect(storeUrl({ AGENTAGE_STORE_URL: url })).toBe(url);
    const dir = await tempPackage({ 'store-url': `${url}-file\n` });
    const env = { AGENTAGE_STORE_URL: url, AGENTAGE_STORE_URL_FILE: `${dir}/store-url` };
    expect(storeUrl(env)).toBe(`${url}-file`);
    expect(storeUrl({ AGENTAGE_STORE_URL_FILE: '/x' }, () => ' from-read ')).toBe('from-read');
    expect(storeUrl({ AGENTAGE_STORE_URL: '' })).toBeUndefined();
    expect(storeUrl({})).toBeUndefined();
  });
});

describe('storeCheck', () => {
  it('is ok when select 1 answers and throws through when it does not', async () => {
    const queries: string[] = [];
    const up: Store = { query: async (text) => (queries.push(text), { rows: [] }) };
    expect(await storeCheck(up)()).toBe('ok');
    expect(queries).toEqual(['select 1']);
    const down: Store = {
      query: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    };
    await expect(storeCheck(down)()).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('createStore', () => {
  it('a store that cannot be reached is UNAVAILABLE, the reason only in the log', async () => {
    const env = { AGENTAGE_STORE_URL: 'postgres://u:p@127.0.0.1:1/db' };
    const { log, lines } = recordedLog();
    const store = createStore(env, log);
    const err = await store.query('select 1').catch((e: unknown) => e);
    expect(isFailure(err)).toBe(true);
    expect(err).toMatchObject({ code: 'UNAVAILABLE', status: 503, retryAfter: 30 });
    expect(err).toMatchObject({ message: 'The store is unavailable', details: undefined });
    const reason = expect.stringMatching(/ECONNREFUSED/);
    expect(lines).toMatchObject([{ level: 'warn', msg: 'store unavailable', reason }]);
    await store.end();
  });
});

describe('isOutage', () => {
  it('is true for connection, shutdown and timeout errors, false for a bad query', () => {
    const coded = (code: string) => Object.assign(new Error('x'), { code });
    for (const code of ['08006', '08001', '57P01', '57P03', '57014', 'ECONNRESET', 'ENOTFOUND'])
      expect(isOutage(coded(code))).toBe(true);
    expect(isOutage(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isOutage(new Error('Query read timeout'))).toBe(true);
    expect(isOutage(new Error('timeout exceeded when trying to connect'))).toBe(true);
    for (const code of ['42601', '23505', '42P01', '57P04x'])
      expect(isOutage(coded(code))).toBe(false);
    expect(isOutage(null)).toBe(false);
  });
});

describe('createTestStore', () => {
  let prepared = 0;
  let store: TestStore;
  beforeAll(async () => {
    store = createTestStore(async (s) => {
      prepared += 1;
      await s.query('create table t (n int); insert into t values (1), (2);');
    });
    await store.query('select 1');
  });
  afterAll(() => store.close());

  it('prepares once on first use; several statements answer with the last', async () => {
    const rows = await store.query('select 0 as z; select sum(n)::int as total from t');
    expect(rows.rows).toEqual([{ total: 3 }]);
    expect((await store.query('select n from t where n = $1', [2])).rows).toEqual([{ n: 2 }]);
    expect((await store.query('create table u (n int)')).rows).toEqual([]);
    expect(prepared).toBe(1);
  });

  it('closes without ever opening', async () => {
    await expect(createTestStore(async () => undefined).close()).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { tempPackage } from '../test-support/packages.js';
import { createStore, storeCheck, storeUrl } from './store.js';
import { createTestStore } from './test-store.js';
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
  it('is a pool that connects on first use and refuses a closed port', async () => {
    const env = { AGENTAGE_STORE_URL: 'postgres://u:p@127.0.0.1:1/db' };
    const store = createStore(env, recordedLog().log);
    await expect(store.query('select 1')).rejects.toThrow(/ECONNREFUSED/);
    await store.end();
  });
});

describe('createTestStore', () => {
  it('prepares once on first use; several statements answer with the last', async () => {
    let prepared = 0;
    const store = createTestStore(async (s) => {
      prepared += 1;
      await s.query('create table t (n int); insert into t values (1), (2);');
    });
    const rows = await store.query('select 0 as z; select sum(n)::int as total from t');
    expect(rows.rows).toEqual([{ total: 3 }]);
    expect((await store.query('select n from t where n = $1', [2])).rows).toEqual([{ n: 2 }]);
    expect((await store.query('create table u (n int)')).rows).toEqual([]);
    expect(prepared).toBe(1);
    await store.close();
  });

  it('closes without ever opening', async () => {
    await expect(createTestStore(async () => undefined).close()).resolves.toBeUndefined();
  });
});

import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { tempPackage } from '../test-support/packages.js';
import { isFailure, type Failure } from '../envelope/envelope.js';
import { createStore, isOutage, storeCheck, storeUrl } from './store.js';
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
  it('a store that cannot be reached is UNAVAILABLE, the reason only in the log', async () => {
    const env = { AGENTAGE_STORE_URL: 'postgres://u:p@127.0.0.1:1/db' };
    const { log, lines } = recordedLog();
    const store = createStore(env, log);
    const err = await store.query('select 1').catch((e: unknown) => e);
    expect(isFailure(err) && err.code).toBe('UNAVAILABLE');
    expect((err as Failure).status).toBe(503);
    expect((err as Failure).retryAfter).toBe(30);
    expect((err as Error).message).toBe('The store is unavailable');
    expect(lines[0]).toMatchObject({ level: 'warn', msg: 'store unavailable' });
    expect(String(lines[0]?.['reason'])).toMatch(/ECONNREFUSED/);
    await store.end();
  });

  it('gives up connecting after the connect timeout, as UNAVAILABLE', async () => {
    // A listener that accepts and never speaks: the connect timeout is all that ends the wait.
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const port = (silent.address() as AddressInfo).port;
    const env = { AGENTAGE_STORE_URL: `postgres://u:p@127.0.0.1:${port}/db` };
    const store = createStore(env, recordedLog().log, { connectMs: 200, statementMs: 1000 });
    const started = Date.now();
    await expect(store.query('select 1')).rejects.toThrow('The store is unavailable');
    expect(Date.now() - started).toBeLessThan(3000);
    await store.end();
    silent.close();
  });
});

describe('isOutage', () => {
  it('is true for connection, shutdown and timeout errors, false for a bad query', () => {
    const coded = (code: string) => Object.assign(new Error('x'), { code });
    for (const code of ['08006', '08001', '57P01', '57P03', '57014', 'ECONNRESET', 'ENOTFOUND'])
      expect(isOutage(coded(code))).toBe(true);
    expect(isOutage(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isOutage(new Error('Query read timeout'))).toBe(true);
    for (const code of ['42601', '23505', '42P01', '57P04x'])
      expect(isOutage(coded(code))).toBe(false);
    expect(isOutage(null)).toBe(false);
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

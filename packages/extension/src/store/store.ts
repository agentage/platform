import { readFileSync } from 'node:fs';
import pg from 'pg';
import { type HealthCheck } from '../health/health.js';
import { type Log } from '../log/log.js';
import { type Env } from '../runtime/build-info.js';
import { type Store } from './store.types.js';

export interface PoolStore extends Store {
  end(): Promise<void>;
}

// The host sets the connection: AGENTAGE_STORE_URL, a secret file named by _FILE, else libpq PG* env.
export const storeUrl = (env: Env, read = (file: string) => readFileSync(file, 'utf8')) => {
  const file = env['AGENTAGE_STORE_URL_FILE'];
  if (file) return read(file).trim();
  return env['AGENTAGE_STORE_URL'] || undefined;
};

export const createStore = (env: Env, log: Log): PoolStore => {
  const pool = new pg.Pool({ connectionString: storeUrl(env), max: 5, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => log.error(err, { store: 'pool' }));
  return {
    query: async (text, params) => pool.query(text, params),
    end: () => pool.end(),
  };
};

export const storeCheck =
  (store: Store): HealthCheck =>
  async () => {
    await store.query('select 1');
    return 'ok';
  };

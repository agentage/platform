import { readFileSync } from 'node:fs';
import pg from 'pg';
import { fail } from '../envelope/envelope.js';
import { type HealthCheck } from '../health/health.js';
import { messageOf, type Log } from '../log/log.js';
import { type Env } from '../runtime/build-info.js';
import { type Store } from './store.types.js';

export interface PoolStore extends Store {
  end(): Promise<void>;
}

export interface StoreTimeouts {
  connectMs: number;
  statementMs: number;
}

// A part's query is bounded by the server and, if the network itself hangs, by the client too.
export const PART_TIMEOUTS: StoreTimeouts = { connectMs: 5_000, statementMs: 10_000 };
const CLIENT_SLACK_MS = 2_000;

// The host sets the connection: AGENTAGE_STORE_URL, a secret file named by _FILE, else libpq PG* env.
export const storeUrl = (env: Env, read = (file: string) => readFileSync(file, 'utf8')) => {
  const file = env['AGENTAGE_STORE_URL_FILE'];
  if (file) return read(file).trim();
  return env['AGENTAGE_STORE_URL'] || undefined;
};

// Connection classes 08 and 57P01-03 (shutdown), 57014 (statement timeout), socket errors, pg's own timeouts.
const OUTAGE_SQLSTATE = /^(08|57P0[1-3]$|57014$)/;
const OUTAGE_SOCKET =
  /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|EPIPE)$/;
const OUTAGE_MESSAGE =
  /timeout exceeded when trying to connect|Query read timeout|Connection terminated/;

export const isOutage = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (OUTAGE_SQLSTATE.test(code) || OUTAGE_SOCKET.test(code)))
    return true;
  return OUTAGE_MESSAGE.test(messageOf(err));
};

// A store that cannot answer is UNAVAILABLE (503, Retry-After), never an INTERNAL 500; no retry here.
const guarded = (pool: pg.Pool, log: Log): Store['query'] =>
  async function query(text, params) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (!isOutage(err)) throw err;
      log.warn('store unavailable', { reason: messageOf(err) });
      throw fail('UNAVAILABLE', 'The store is unavailable');
    }
  };

export const createStore = (env: Env, log: Log, timeouts = PART_TIMEOUTS): PoolStore => {
  const pool = new pg.Pool({
    connectionString: storeUrl(env),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: timeouts.connectMs,
    statement_timeout: timeouts.statementMs,
    query_timeout: timeouts.statementMs + CLIENT_SLACK_MS,
  });
  pool.on('error', (err) => log.error(err, { store: 'pool' }));
  return { query: guarded(pool, log), end: () => pool.end() };
};

export const storeCheck =
  (store: Store): HealthCheck =>
  async () => {
    await store.query('select 1');
    return 'ok';
  };

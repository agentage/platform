import { type QueryResult, type Row, type Store } from './store.types.js';

interface PGliteLike {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  exec(text: string): Promise<{ rows: Row[] }[]>;
  close(): Promise<void>;
}

export interface TestStore extends Store {
  close(): Promise<void>;
}

const open = async (): Promise<PGliteLike> => {
  try {
    const { PGlite } = (await import('@electric-sql/pglite')) as unknown as {
      PGlite: new () => PGliteLike;
    };
    return new PGlite();
  } catch {
    throw new Error('a test store needs @electric-sql/pglite: npm install -D @electric-sql/pglite');
  }
};

// Like pg: a parameterless query may hold several statements (migrations), the last one answers.
const bound = (db: PGliteLike): Store => ({
  query: async <R extends Row>(text: string, params?: unknown[]): Promise<QueryResult<R>> => {
    if (params && params.length > 0) return db.query<R>(text, params);
    const results = await db.exec(text);
    return { rows: (results.at(-1)?.rows ?? []) as R[] };
  },
});

// In-process Postgres (WASM): a throwaway store of the same kind, prepared once on first use.
export const createTestStore = (prepare: (store: Store) => Promise<unknown>): TestStore => {
  let ready: Promise<Store & { db: PGliteLike }> | undefined;
  const start = async () => {
    const db = await open();
    const store = bound(db);
    await prepare(store);
    return { ...store, db };
  };
  return {
    query: async (text, params) => {
      ready ??= start();
      return (await ready).query(text, params);
    },
    close: async () => {
      if (ready) await (await ready).db.close();
    },
  };
};

export type Row = Record<string, unknown>;

export interface QueryResult<R extends Row = Row> {
  rows: R[];
}

// ctx.store for a postgres store: a ready pool. Part code never sees a URL or a credential.
export interface Store {
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

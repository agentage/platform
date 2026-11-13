# Write the parts

Each part of an extension package exports only `create(ctx)`; the kit owns servers, ports,
`/health`, discovery, the envelope, the store connection, the scheduler and argument parsing.

```ts
// src/api/index.ts: an Express router mounted at /api/v1/
export const create = (ctx: PartContext): Router => {
  /* ctx.store.query(...) */
};
// src/mcp/index.ts: tools served as {id}__{name} on POST /mcp (SDK v2, stateless)
export function create(ctx: McpContext) {
  ctx.tool(
    'echo',
    { description, input: z.object({ msg: z.string() }), output: z.object({ msg: z.string() }) },
    async ({ msg }) => ({ msg: `pong ${msg}` })
  );
}
// src/worker/index.ts: five-field cron, never twice at once, every run saved with its log
export function create({ schedule, store, log }: WorkerContext) {
  schedule(
    'tick',
    '* * * * *',
    async () => {
      /* ... */
    },
    { timeout: '30s' }
  );
}
// src/cli/index.ts: one handler per command in agentage.commands
export function create({ out, args }: CliContext) {
  return { ping: async () => (out.log('pong'), 0) };
}
// src/pages/index.ts: path -> text or bytes typed by the extension (a bare path is HTML);
// siteFromDir(dir, { origin: ctx.extension.origin }) serves a static export instead
// { redirect: url } answers 308; a '/docs/*' key covers its subtree, the rest and query appended
// a redirect is an http(s) URL with a path and no query; under a '/*' key it ends in '/'
export const create = (ctx: PagesContext): PagesSite => ({ '/': versionPage(ctx) });
```

The ui part is a `widgets` map on [`@agentage/widget`](../packages/widget).

The manifest is the `agentage` block of the extension's `package.json`. See
[extension-probe](https://github.com/agentage/extension-probe) for every part kind.

## Store

A postgres store adds two folders:

- `migrations/NNN-name.sql`: applied in order, each once, and recorded in `_migrations`. A failing
  file is named and rolled back.
- `seeds/`: applied once, only on a store with no ledger row and no table but the kit's. They stay
  owed after a failed first run, so a later run still seeds.

`ctx.store` is a ready pool. A query gets 10 s, a connection 5 s. A store that cannot answer is
`UNAVAILABLE` (503, `Retry-After`), never a 500.

## Workers and commands

- Worker runs land in `agentage_job_runs`: job, start, end, status, log (64 KB cap), the last 50
  per job. Without a store they stay in memory. `/health` reports `job:{name}`.
- Commands answer with `out.log/warn/error/table/json/fail`.
- Exit codes: 0 ok, 2 usage, 1 failure. `--json` sends only `out.json` to stdout.

## Logs and spans

- `ctx.span(name, fn)` runs `fn` and writes one `span` row on the current agcid. The value and
  any throw pass through. It is on server parts and the cli.
- Every request is one `http` row, every `tools/call` one `mcp` row, every job run one `job` row.
- The agcid comes from the `agcid` header or `traceparent`; otherwise the kit mints one.
- `ctx.exit()` runs the normal SIGTERM shutdown once the current answer is sent. Part code never
  touches `process`.
- `ctx.health(name, check)` adds a check to `/health`.

## Tests

- `createTestContext()`: a recording log, `ctx.spans`, jobs you run with `runJob`, tools.
  `{ store: true }` gives a throwaway in-process postgres with the package's migrations and seeds.
  `{ args }` gives a command context that records its output.
- `startTestServer({ create })` tests an api part. `startTestMcp({ create })` tests an mcp part.
- `mcpSnapshot(url, '2025-11-25' | '2026-07-28')` from `@agentage/extension/tool` writes the
  committed `{id}.mcpc.json`.
- The wire schemas a client reads are in `@agentage/extension/contracts`.

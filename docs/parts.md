# Write the parts

Each part of an extension package exports only `create(ctx)`. The kit owns servers, ports,
`/health`, discovery, the envelope, the store connection, the scheduler and argument parsing. The
envelope is the kit's standard JSON shape for every answer.

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
// src/pages/index.ts: path -> text or bytes, typed by the path's extension
export const create = (ctx: PagesContext): PagesSite => ({ '/': versionPage(ctx) });
```

The pages part maps each path to a page:

- A value is text or bytes. Its content type comes from the path's extension. A path with no
  extension is HTML.
- `siteFromDir(dir, { origin: ctx.extension.origin })` serves a static export instead of a map.
- A `{ redirect: url }` value answers 308.
- A key that ends in `/*` covers every path under it. The rest of the path and the query are added
  to the target URL.
- A redirect target is an http(s) URL with a path and no query. Under a `/*` key it ends in `/`.

The ui part is a `widgets` map on [`@agentage/widget`](../packages/widget).

The manifest is the `agentage` block of the extension's `package.json`. See
[extension-probe](https://github.com/agentage/extension-probe) for every part kind.

## Store

A postgres store adds two folders:

- `migrations/NNN-name.sql`: applied in order, each once, and recorded in `_migrations`. A failing
  file is named and rolled back.
- `seeds/`: runs once, on an empty store. An empty store has no `_migrations` row and no table
  except the kit's own. If the first run fails, the next run tries the seeds again.

`ctx.store` is a ready connection pool. A query gets 10 s. A connection gets 5 s. A store that
cannot answer gives `UNAVAILABLE` (503, with `Retry-After`), never a 500.

## Workers and commands

- Each worker run is saved in the table `agentage_job_runs`. A row holds the job, start, end,
  status and log. The log is cut at 64 KB. The table keeps the last 50 runs per job.
- Without a store, the runs stay in memory. `/health` reports each job as `job:{name}`.
- Commands answer with `out.log/warn/error/table/json/fail`.
- Exit codes: 0 ok, 2 usage, 1 failure. `--json` sends only `out.json` to stdout.

## Logs and spans

- `ctx.span(name, fn)` runs `fn` and writes one `span` row on the current agcid. The value and
  any throw pass through. It is on server parts and the cli.
- Every request is one `http` row, every `tools/call` one `mcp` row, every job run one `job` row.
- The agcid (the request id) comes from the `agcid` header or `traceparent`. Without either, the
  kit mints one.
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

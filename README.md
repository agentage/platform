# platform

Everything an agentage extension author imports or runs, and no product code. Two packages:

- [`@agentage/extension`](packages/extension): the extension kit (a part exports only
  `create(ctx)`; the kit owns servers, `/health`, discovery, the correlation id, the envelope, the
  store and the scheduler) and its tool (one image per part, `up` on a laptop, dev tokens).
- [`@agentage/widget`](packages/widget): the ui part. React widgets as custom elements in a
  shadow root, the host bridge (`useHost`), design-system `Button` and `Card`, and the bundler
  with its harness page.

## Install

```bash
npm ci
npm run build
```

## Write the parts

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
// src/pages/index.ts: path -> HTML (a static page in kit 0.2)
export const create = (ctx: PagesContext): PagesSite => ({ '/': versionPage(ctx) });
```

The ui part is a `widgets` map on [`@agentage/widget`](packages/widget). A postgres store adds
`migrations/NNN-name.sql` (applied in order, each once, recorded in `_migrations`; a failing file
is named and rolled back) and `seeds/` (applied once, only on a store with no ledger row and no
table but the kit's, still owed after a failed first run); `ctx.store` is a ready pool: a query gets 10 s (statement timeout), a connection
5 s, and a store that cannot answer is `UNAVAILABLE` (503, `Retry-After`), never a 500. Worker
runs land in `agentage_job_runs` (job, start, end, status, log capped at 64 KB, the last 50 per
job; in memory without a store), and `/health` reports `job:{name}`. Commands answer
`out.log/warn/error/table/json/fail`; exit codes 0 ok, 2 usage, 1 failure; `--json` routes only
`out.json` to stdout.

The manifest is the `agentage` block of the extension's `package.json` (see
[extension-probe](https://github.com/agentage/extension-probe) for every part kind).

Unit tests: `createTestContext()` (a recording log, scheduled jobs you run with `runJob`, tools,
`{ store: true }` for a throwaway in-process postgres with the package's migrations and seeds,
`{ args }` for a command ctx that records its output), `startTestServer({ create })` for an api
part and `startTestMcp({ create })` with `mcpSnapshot(url, '2025-11-25' | '2026-07-28')` for the
committed `{id}.mcpc.json`.

## The tool: build, up, token

```bash
node packages/extension/dist/tool/cli.js build [--push] [--dir <ext>] [--registry <host/owner>]
node packages/extension/dist/tool/cli.js up [--dir <ext>]       # agentage extension up
node packages/extension/dist/tool/cli.js down [--keep-data]
node packages/extension/dist/tool/cli.js token --scope probe:read
```

`build` validates the manifest, runs the package's `npm run build`, runs the six check rules
(`tool/check.ts`, `tool/rules/`: manifest, entries, surface, stack, store, sealing; any problem
stops it before an image; `npm run check:fixtures` shows one fixture refused per rule), then
builds one image per part
(pages, ui, api, mcp, worker) from the kit recipe (multi-stage `node:26-alpine`, `npm ci
--omit=dev`, `USER node`, `COMMIT_SHA`/`BUILD_TIME`, a `HEALTHCHECK` on `127.0.0.1`), tagged
`ghcr.io/agentage/{id}-{part}:{version}` with the OCI revision and created labels. Each image
carries only `dist/{part}` and `dist/lib`; the api image also carries `openapi.json`,
`migrations/` and the migrate entry `node dist/store/migrate.js`; seeds never ship in an image.
`--push` pushes and writes `dist/agentage-extension.json` (images by digest, tools, commands,
widgets, the store and its migration count, the OpenAPI path).

`up` builds the same images, writes `.agentage/record.json` from the local digests, renders one
compose file (postgres 18 with the migrate job first and the package's `seeds/` mounted into it, a
dev token issuer on `localhost:4281`, a Traefik gateway on `localhost:4280` with the deployment URL
layout, one container per part) and prints one line per step, ending `ready N parts healthy`. Each
working copy is its own compose project (`agentage-{id}-{8 hex of the folder}`), so `up` refuses
while another copy holds 4280 or 4281 (naming it), and on a kept volume the store line says
`already applied`. `down` removes this copy's project only and names it (`--keep-data` keeps the
store volume). `token` mints a dev token (`aga_` + EdDSA JWT, `{id}:{verb}` scopes, 1 hour) that the
parts of `up` check like a deployment's; the issuer also takes `ttlSeconds`, `aud` and
`POST /revoke { jti }`. Every docker, git and npm call has a timeout (`tool/timeouts.ts`); none retries, and
a re-run is safe. The cli runs the same code as `agentage extension check|build|up|down|token`
through `@agentage/extension/tool`, plus `runCommand` and `checkCli` for installed commands.

## Run a part image

|                                                           |                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Entry                                                     | `node node_modules/@agentage/extension/dist/runtime/main.js <part>`; port `3000` (`PORT` overrides) |
| `/health`                                                 | loopback only (the container `HEALTHCHECK`, an operator on the node); `404` from any other address  |
| `/.well-known/agentage-extension.json`                    | the record at `/run/agentage/agentage-extension.json` (`AGENTAGE_RECORD_FILE`) plus the host        |
| `AGENTAGE_ORIGIN`                                         | the deployment's origin; pages and ui take it from the request without it                           |
| `AGENTAGE_SETTINGS`                                       | JSON of setting values over the manifest defaults                                                   |
| `AGENTAGE_STORE_URL` / `_FILE`                            | the postgres connection (or a file holding it); else libpq `PG*` variables                          |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN` | required for api and mcp: without them, or with a host off the audience, the part does not start    |
| `AGENTAGE_DEV_ISSUER`                                     | set by `up` for the ui part only: its CSP then lets the harness reach the dev issuer                |

Schemas for the manifest, the build record, the discovery document, `/health` and the envelope are
in [`packages/extension/schemas`](packages/extension/schemas), generated from the kit's Zod schemas
(`npm run build && npm run schemas`).

## Write a widget

`src/ui/index.ts` exports `widgets = { echo: Echo }`, each a React component
([example](packages/widget/README.md)). The kit gives:

| Import                      | Gives                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@agentage/widget`          | `useHost()`: `tool(name, args)` resolves the tool's `structuredContent` (rejects with its `error.code`), `api(path, init)` resolves the `/api/v1` envelope's `data`, `context` (extension, version, path, theme); types `Host`, `HostContext`, `ToolOutputs` |
| `@agentage/widget/ds`       | design-system `Button` and `Card` (`title` plus children) styled inside the shadow root; light and dark follow `prefers-color-scheme`                                                                                                                        |
| `@agentage/widget/register` | `registerWidgets(id, widgets, { version })`: defines `{id}-{kebab name}` once, open shadow root, adopted sheet, React root that shows an error box when the widget throws                                                                                    |
| `@agentage/widget/bundle`   | `bundle({ dir })`, also the bin `agentage-widget bundle [--dir <ext>]` (exit 0 ok, 1 failure, 2 usage)                                                                                                                                                       |

The bundler reads `agentage.id` and `version` from the extension's `package.json` and writes
`dist/ui/`: `{id}.js` (one minified self-contained ESM module: React, components, CSS; it calls
`registerWidgets` on load), `widgets.json` (`[{ name, element, module: "/ui/{version}/{id}.js" }]`,
names read from a node build of the map), `harness.html` and `harness.js`.

The harness page mounts every widget from `widgets.json` (or `?widget=<name>`) and bridges
`tool` to `POST /mcp` as one 2026-07-28 JSON-RPC `tools/call` (`MCP-Protocol-Version`,
`Mcp-Method`, `Mcp-Name` headers, a JSON or `text/event-stream` answer) and `api` to
`/api/v1{path}`, each call bounded at 30 s (`TIMEOUT`); a refusal before the tool runs (a 401,
403 or 503) rejects with the envelope's code. Its token: `?token=` wins; on `localhost` or
`127.0.0.1` it asks the dev issuer at `http://localhost:4281/token` for `{id}:read` (5 s); else it
calls anonymously. The token stays in the bridge. The page has no inline script, so it runs under
the ui part's CSP.

A shell mounts a widget by setting the element's `host` before it connects; without one the
element uses `globalThis.__agentageHost?.(element)`, else an anonymous same-origin bridge.

## Verify

```bash
npm run verify
npm run test:e2e      # widget harness, axe WCAG A/AA and screenshots in both themes, Chromium; baselines come from the CI container
```

## Release

A `v*` tag (or a manual dispatch) runs `.github/workflows/release.yml`, which publishes every
package version not yet on npm with OIDC trusted publishing and provenance. Before that, CI builds
[extension-probe](https://github.com/agentage/extension-probe) on the packed packages, runs `up`,
and checks every part image and the served discovery document, so a kit change is proven in
containers before it ships.

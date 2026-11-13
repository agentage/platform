# platform

The kit for writing an agentage extension. Authors of extensions use it; so do the cli and the
shell pages that run them. It holds no product code.

Words used here:

- **Extension**: one npm package whose `package.json` has an `agentage` block (the manifest).
- **Part**: one folder of an extension: `pages`, `ui`, `api`, `mcp`, `worker` or `cli`. It exports only `create(ctx)`.
- **Kit**: the library that runs a part. `@agentage/extension` is the kit; it owns servers, ports, `/health`, discovery, the envelope, the store and the scheduler.
- **Tool**: the build and local-run program in the kit (`build`, `up`, `down`, `token`). The cli runs it as `agentage extension ...`.
- **agcid**: the request id. It is 32 hex characters.
- **Record**: the build file that lists a release's images by digest (`.agentage/record.json`).
- **Sealing**: the check rule that part code may not read `process.env`, call `listen()` or name an absolute agentage URL.

## Packages

- [`@agentage/extension`](packages/extension): the extension kit and its tool (one image per part).
- [`@agentage/logs`](packages/logs): the event line: one JSON row per unit of work on stderr.
  It is private: the kit ships it inside its own tarball. Import it from `@agentage/extension/logs`.
- [`@agentage/widget`](packages/widget): the `ui` part. React widgets as custom elements, the host
  bridge (`useHost`), `Button` and `Card`, and the bundler with its harness page.
- [`@agentage/shell`](packages/shell): the shell kit. `readInstallation` reads what a target runs.
  `mountWidgets` places each extension's widgets by the layout of a route.
- [`@agentage/identity`](packages/identity): the identity client for browser pages. Sign in at
  auth, get a one-hour token for the parts, `mintToken`, `revokeToken`, sign out.

## Work on this repo

```bash
npm ci
npm run build
npm run verify
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
// src/pages/index.ts: path -> text or bytes typed by the extension (a bare path is HTML);
// siteFromDir(dir, { origin: ctx.extension.origin }) serves a static export instead
// { redirect: url } answers 308; a '/docs/*' key covers its subtree, the rest and query appended
// a redirect is an http(s) URL with a path and no query; under a '/*' key it ends in '/'
export const create = (ctx: PagesContext): PagesSite => ({ '/': versionPage(ctx) });
```

The ui part is a `widgets` map on [`@agentage/widget`](packages/widget).

The manifest is the `agentage` block of the extension's `package.json`. See
[extension-probe](https://github.com/agentage/extension-probe) for every part kind.

### Store

A postgres store adds two folders:

- `migrations/NNN-name.sql`: applied in order, each once, and recorded in `_migrations`. A failing
  file is named and rolled back.
- `seeds/`: applied once, only on a store with no ledger row and no table but the kit's. They stay
  owed after a failed first run, so a later run still seeds.

`ctx.store` is a ready pool. A query gets 10 s, a connection 5 s. A store that cannot answer is
`UNAVAILABLE` (503, `Retry-After`), never a 500.

### Workers and commands

- Worker runs land in `agentage_job_runs`: job, start, end, status, log (64 KB cap), the last 50
  per job. Without a store they stay in memory. `/health` reports `job:{name}`.
- Commands answer with `out.log/warn/error/table/json/fail`.
- Exit codes: 0 ok, 2 usage, 1 failure. `--json` sends only `out.json` to stdout.

### Logs and spans

- `ctx.span(name, fn)` runs `fn` and writes one `span` row on the current agcid. The value and
  any throw pass through. It is on server parts and the cli.
- Every request is one `http` row, every `tools/call` one `mcp` row, every job run one `job` row.
- The agcid comes from the `agcid` header or `traceparent`; otherwise the kit mints one.
- `ctx.exit()` runs the normal SIGTERM shutdown once the current answer is sent. Part code never
  touches `process`.
- `ctx.health(name, check)` adds a check to `/health`.

### Tests

- `createTestContext()`: a recording log, `ctx.spans`, jobs you run with `runJob`, tools.
  `{ store: true }` gives a throwaway in-process postgres with the package's migrations and seeds.
  `{ args }` gives a command context that records its output.
- `startTestServer({ create })` tests an api part. `startTestMcp({ create })` tests an mcp part.
- `mcpSnapshot(url, '2025-11-25' | '2026-07-28')` from `@agentage/extension/tool` writes the
  committed `{id}.mcpc.json`.
- The wire schemas a client reads are in `@agentage/extension/contracts`.

## The tool: build, up, token

The paths below are relative to the root of this repo. Pass `--dir <ext>` to name the extension
folder (the default is the current folder); inside an extension, `npx agentage extension <command>`
runs the same tool. `build` and `up` need Docker, and the extension must be a git checkout with a
commit.

```bash
node packages/extension/dist/tool/cli.js build [--push] [--dir <ext>] [--registry <host/owner>]
node packages/extension/dist/tool/cli.js up [--dir <ext>]       # agentage extension up
node packages/extension/dist/tool/cli.js down [--keep-data]
node packages/extension/dist/tool/cli.js token --scope probe:read
```

`build` runs these steps in order:

1. Validate the manifest and run the package's `npm run build`.
2. Run the six check rules (`tool/check.ts`, `tool/rules/`). Any problem stops the build before an
   image. A manifest problem stops the later rules.
3. Build one image per part (pages, ui, api, mcp, worker), tagged
   `ghcr.io/agentage/{id}-{part}:{version}`.
4. With `--push`, push the images and write `dist/agentage-extension.json` (images by digest,
   tools, commands, widgets, the store and its migration count, the OpenAPI path).

The six rules:

| Rule       | Checks                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest` | the `agentage` block is valid; a problem here stops the later rules                                                                    |
| `entries`  | `npm run build` ran (`dist/` exists); each part is built and exports only `create`; no export holds part code                          |
| `surface`  | the committed `openapi.json` and `{id}.mcpc.json` equal what the code serves                                                           |
| `stack`    | dependency ranges fit express 5, zod 4, `@modelcontextprotocol/server` 2 and the kit range in `engines.agentage`                       |
| `store`    | migrations apply on a real postgres; `check` skips it without Docker                                                                   |
| `sealing`  | no `process`, no `listen()`, no absolute agentage URL; a part imports only its own folder and `src/lib` (type-only imports are exempt) |

`npm run check:fixtures` shows one fixture refused per rule. Under `build` the `store` rule needs
Docker and fails without it (`tool/rules/store.ts`).

Each image is multi-stage `node:26-alpine` with `npm ci --omit=dev`, `USER node` and a
`HEALTHCHECK` on `127.0.0.1`. It carries only `dist/{part}` and `dist/lib`. The api image also
carries `openapi.json`, `migrations/` and the migrate entry `node dist/store/migrate.js`. Seeds
never ship in an image.

`up` runs these steps:

1. Build the same images and write `.agentage/record.json` from the local digests.
2. Render one compose file: postgres 18 (migrate job first, `seeds/` mounted), a dev token issuer
   on `localhost:4281`, a Traefik gateway on `localhost:4280`, one container per part.
3. Print one line per step, ending `ready N parts healthy`.

Each working copy is its own compose project (`agentage-{id}-{8 hex of the folder}`). `up`
refuses while another copy holds 4280 or 4281, and names that copy. `down` removes this copy's
project only; `--keep-data` keeps the store volume.

`token` mints a dev token: `aga_` plus an EdDSA JWT, `{id}:{verb}` scopes, valid 1 hour. `--scope`
is required. The parts of `up` check it like a deployment's. The issuer also takes `ttlSeconds`,
`aud` and `POST /revoke { jti }`.

Every docker, git and npm call has a timeout (`tool/timeouts.ts`). None retries, so a re-run is
safe. The cli runs the same code as `agentage extension check|build|up|down|token` through
`@agentage/extension/tool`.

## Run a part image

| Setting                                                   | Meaning                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Entry                                                     | `node node_modules/@agentage/extension/dist/runtime/main.js <part>`; port `3000` (`PORT` overrides) |
| `/health`                                                 | loopback only (the container `HEALTHCHECK`, an operator on the node); `404` from any other address  |
| `/.well-known/agentage-extension.json`                    | the record at `/run/agentage/agentage-extension.json` (`AGENTAGE_RECORD_FILE`) plus the host        |
| `AGENTAGE_ORIGIN`                                         | the deployment's origin; pages and ui take it from the request without it                           |
| `AGENTAGE_SETTINGS`                                       | JSON of setting values over the manifest defaults                                                   |
| `AGENTAGE_STORE_URL` / `_FILE`                            | the postgres connection (or a file holding it); else libpq `PG*` variables                          |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE`, `AGENTAGE_ORIGIN` | required for api and mcp: without them, or with a host off the audience, the part does not start    |
| `AGENTAGE_ISSUER`, `AGENTAGE_AUDIENCE` on pages           | CSP script-src, connect-src add these hosts; helmet's style-src keeps 'unsafe-inline'               |
| `AGENTAGE_TELEMETRY_URL`                                  | `ctx.platform.telemetry` (with `issuer`, `audience`; a value a part lacks is `''`)                  |
| `AGENTAGE_DEV_ISSUER`                                     | set by `up` for the ui part only: its CSP then lets the harness reach the dev issuer                |
| `Cookie` request header                                   | dropped before any handler; a part sets no cookie and its CORS carries no credentials               |

JSON Schemas for the manifest, the build record, the discovery document, `/health` and the
envelope are in [`packages/extension/schemas`](packages/extension/schemas). Regenerate them with
`npm run build && npm run schemas`.

## Write a widget

`src/ui/index.ts` exports `widgets = { echo: Echo }`, each a React component. The full API, the
import table and the harness page are in [`packages/widget`](packages/widget/README.md).

## Verify

```bash
npm run verify
npm run test:e2e
```

`test:e2e` runs the widget harness in Chromium with an axe WCAG A/AA sweep and screenshots in both
themes. Baselines come from the CI container image.

## Release

A `v*` tag, or a manual dispatch, runs `.github/workflows/release.yml`. It publishes every package
version not yet on npm, using OIDC trusted publishing with provenance, and skips private packages.

Before that, CI builds [extension-probe](https://github.com/agentage/extension-probe) on the
packed packages, runs `up`, and checks every part image and the served discovery document. A kit
change is proven in containers before it ships.

# CLAUDE.md - agentage/platform

Public repo. The extension kit and its build tool, and the widget kit; no product code. Standards: the engineering
standards batch (repo-baseline, typescript, monorepo, code-style, testing, ci-cd, docker-deploy,
security, backend); this file only adds what the tree does not say. Words (part, kit, tool,
agcid, record, sealing), the tool's behavior and the part-image settings are in
[README.md](README.md); this file does not repeat them.

## Commands

- `npm run verify` - type-check (`tsc -b` + the test tsconfig), lint, format, tests with coverage, build
- `npm run build && npm run schemas` - regenerate `packages/extension/schemas/*.json` from Zod; a
  test fails when the committed files drift
- The tool: `node packages/extension/dist/tool/cli.js build|up|down|token` (`tool/main.ts`).
  `up` serves the gateway on `localhost:4280`; `token --scope <id>:<verb>` needs `--scope` and
  mints an `aga_` token from the dev issuer on `:4281`. Details: README.md, "The tool".
- One package's tests: `npx vitest run packages/<p>`; its type-check:
  `npx tsc -p packages/<p>/tsconfig.eslint.json --noEmit`
- A version bump touches the package's `package.json`; widget also `src/host/version.ts`; extension
  also the kit range `^<major.minor>` in `fixtures/*/package.json`, `src/test-support/packages.ts`
  and `src/tool/check.test.ts`
- Bump a package's version only when that package's files changed (`scripts/check-bumps.mjs` gates PRs)
- A new package: `tsconfig.json`, `tsconfig.eslint.json`, a root `tsconfig.json` reference, a
  `type-check` line, a CI pack-smoke step, then the lock (`npx npm@10 install`)
- Release: tag `v<version>` on master (the release workflow publishes every package not on npm yet)
- Lockfile edits go through `npx npm@10 install`; keep only the lines you mean to change

## Commits

- Scopes: `extension, logs, widget, identity, shell, release, ci, docs, deps`; repo-level `ci`, `docs`, `chore`
  and `build` commits may go scopeless. Titles are conventional commits, 72 characters at most; CI
  checks the PR title.
- A release bump commit touches one package, or uses the `release` scope.

## Layout (`packages/extension/src`)

- `envelope/` ok, fail, parse, the closed error codes; `agcid/` UUIDv7, the request scope
  (`current.ts` has no express import, so logs and the tool stay loadable by the cli)
- `manifest/` the Zod manifest (`package.json` `agentage` key), parts normalization, reader,
  `entry.ts` (`loadCreate`: the one way part, command and build code reach a part's `create`)
- `discovery/` the build record, the served discovery document, the committed `openapi.json`
- `context/` ctx, settings from `AGENTAGE_SETTINGS`, `createTestContext` (parts and commands)
- `server/` the kit app every part runs (`createPartApp`), errors, listen and shutdown
- `runtime/` the image entry `dist/runtime/main.js <part>` and `RUNNERS`, one per part kind
- `api/` `ctx.route` registry and the OpenAPI generator (no express import: the tool reads it);
  `server/api-routes.ts` mounts the routes
- `mcp/` tool registry, SDK v2 server factory, the `/mcp` app, the two-era snapshot client
- `worker/` cron, scheduler (no overlap, run log capture), `agentage_job_runs`
- `store/` the pg pool, migrations and seeds, the migrate entry `dist/store/migrate.js`, the
  in-process test store (PGlite, an optional peer)
- `pages/`, `ui/` the static page helper and the ui file server; `command/` the cli part runner
- `tool/` build, `check.ts` and `rules/` (the six conformance rules; `fixtures/` holds one
  base package and one overlay per rule, `npm run check:fixtures`), the per-part stage and recipe,
  the record extras, `up/` (compose, gateway,
  dev issuer, wait, down, token); exported as `@agentage/extension/tool`; it must not import the
  server stack (`tool-imports.test.ts` guards it, the cli loads it)
- `contracts/` the wire schemas clients read (envelopes, discovery, health, agcid); exported as
  `@agentage/extension/contracts`; it imports zod only (`contracts-imports.test.ts` guards it)
- `index.test.ts` pins the three public surfaces (sealing): main keeps the author surface
- `schemas/` JSON Schema generation; `test-support/` fixtures, excluded from the build

## Layout (`packages/widget`)

- `src/host/` the bridge: `useHost`, `tool` (2026-07-28 `tools/call` over `POST /mcp`), `api`
- `src/ds/` `Button`, `Card` and the sheet: `widget.css` compiled by `scripts/build-css.mjs` into
  the gitignored `styles.generated.ts` (`npm run css`, run by type-check, test and build);
  `@property` goes to the document, the rest is adopted per shadow root
- `src/register/` `registerWidgets`, the element (`defineWidget`, internal), the error box
- `src/bundle/` the bundler and the `agentage-widget` bin; `src/harness/` the harness page logic
  (bundled to `dist/ui/harness.js`; the template is `harness/harness.html`)
- `e2e/` Playwright: bundles the fixture, serves it under the ui CSP with a stub `/mcp`, an axe
  WCAG A/AA sweep (it reaches into the shadow root) and screenshots in light and dark;
  `src/test-support/fixture` is the probe's echo widget; widget `.tsx` lints with
  jsx-a11y and react-hooks (`overrides` lets jsx-a11y run on ESLint 10)

## Layout (`packages/logs`)

- `event.schema.ts` the line (`EventSchema`, seven kinds), `rows.ts` and `error-row.ts` one row per unit
  of work with its level rule, `logger.ts` (`loggerOf` over one `row` sink, `createLogger` to
  stderr), `redact.ts`, `parse-line.ts` (a non-event line is a raw `log` row), `events-client.ts`
  (batches under 1 MB, 5 s timeout, one retry), `uuidv7.ts` (the agcid, 32 hex). zod and node only:
  the kit and the cli load it, so no express. The kit feeds the request context
  (`agcid/current.ts`, `log/who.ts`).

## Layout (`packages/identity`, `packages/shell`)

- identity: `auth.schema.ts` (schemas, types), `auth.client.ts` (auth's REST, typed errors), `identity.ts` (`createIdentity`, the token
  cache), `index.ts`, `test-support/fake-auth.ts` (a fake auth built from `fixtures/auth-*.json`)
- shell: `installation.schema.ts` (installation, overlay, discovery slice), `http.ts` (`send`,
  `getJson`, `trimSlash`, `ShellError`), `read-installation.ts` (root calls, etag), `mount-widgets.ts`, `index.ts`, `discovery-drift.test.ts` (the
  kit's published patterns), `fixtures/installation.json` (the README document)

## Gotchas

- Screenshot baselines are made in `mcr.microsoft.com/playwright:v1.64.1-noble` (the CI job's
  image), never on a host: `npx playwright test -c packages/widget --update-snapshots` inside it.
- Browser code uses `zod/mini` with `import * as z`: full `zod` or a named import puts about
  400 KB into every widget bundle.
- The bundler resolves `@agentage/widget/*` to its own copy, so one bundle has one runtime.
- `express` is an optional peer: extensions declare it, the cli (tool only) does not get it.
- The record is mounted into the container at deploy time: an image cannot carry its own digest.
- `/health` checks the socket's local address, so a published Docker port answers 404 by design;
  use `--network host` or `docker exec` to read it.
- `ctx.store` is always present; without a store part it throws on first use.
- The pages part is a kit-served static map; the kit serves no Next.js pages.
- Tokens are on in every api and mcp part (`auth/part-auth.ts`). Without `AGENTAGE_ISSUER`, or
  with a host off `AGENTAGE_AUDIENCE`, the part does not start. Each route asks
  for its OpenAPI operation's access, each `tools/call` for its tool's `scope` (read when
  undeclared). The test servers (`startTestServer`, `startTestMcp`) run without a check and
  `createTestContext` gives a fixed caller. Under `up` the tokens name the issuer
  `http://issuer:3000` (the parts reach it there) while the host mints at `localhost:4281`.
- `up` names its compose project per working copy; scripts reach it with
  `-f .agentage/compose.json`, never `-p`. The ui CSP allows the dev issuer only when
  `AGENTAGE_DEV_ISSUER` is set (only `up` sets it).
- CI's image smoke clones extension-probe master (or, on a PR, the probe branch of the same name
  when one exists), installs the packed packages it uses and runs `up`: a probe change can turn
  this CI red, and a kit change that breaks the probe never reaches npm.
- Public repo: no secrets, no internal hosts, no provider names, no roadmap in code or docs.
- Docs: sentences of 25 words or fewer, no em dash, no plan ids a reader cannot open.

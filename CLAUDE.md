# CLAUDE.md - agentage/platform

Public repo. The extension kit and its build tool, and the widget kit; no product code. Standards: the engineering
standards batch (repo-baseline, typescript, monorepo, code-style, testing, ci-cd, docker-deploy,
security, backend); this file only adds what the tree does not say.

## Commands

- `npm run verify` - type-check (`tsc -b` + the test tsconfig), lint, format, tests with coverage, build
- `npm run build && npm run schemas` - regenerate `packages/extension/schemas/*.json` from Zod; a
  test fails when the committed files drift
- `node packages/extension/dist/tool/cli.js build [--push] [--dir <ext>] [--registry <host/owner>]`

## Layout (`packages/extension/src`)

- `envelope/` ok, fail, parse, the closed error codes; `agcid/` UUIDv7, the request scope
  (`current.ts` has no express import, so logs and the tool stay loadable by the cli)
- `manifest/` the Zod manifest (`package.json` `agentage` key), parts normalization, reader,
  `entry.ts` (`loadCreate`: the one way part, command and build code reach a part's `create`)
- `discovery/` the build record, the served discovery document, the committed `openapi.json`
- `context/` ctx, settings from `AGENTAGE_SETTINGS`, `createTestContext` (parts and commands)
- `server/` the kit app every part runs (`createPartApp`), errors, listen and shutdown
- `runtime/` the image entry `dist/runtime/main.js <part>` and `RUNNERS`, one per part kind
- `mcp/` tool registry, SDK v2 server factory, the `/mcp` app, the two-era snapshot client
- `worker/` cron, scheduler (no overlap, run log capture), `agentage_job_runs`
- `store/` the pg pool, migrations and seeds, the migrate entry `dist/store/migrate.js`, the
  in-process test store (PGlite, an optional peer)
- `pages/`, `ui/` the static page helper and the ui file server; `command/` the cli part runner
- `tool/` build, the per-part stage and recipe, the record extras, `up/` (compose, gateway,
  dev issuer, wait, down, token); exported as `@agentage/extension/tool`; it must not import the
  server stack (`tool-imports.test.ts` guards it, the cli loads it)
- `index.test.ts` pins both public surfaces (sealing)
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
  `src/test-support/fixture` is the probe's echo widget (C7 text); widget `.tsx` lints with
  jsx-a11y and react-hooks (`overrides` lets jsx-a11y run on ESLint 10)

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
- The pages part is a kit-served static map in 0.2 (Next.js pages are a later kit).
- `mcp.listing: token` closes `tools/list` with 401 until the kit verifies tokens.
- CI's image smoke clones extension-probe master, installs the packed packages it uses and runs
  `up`: a probe change can turn this CI red, and a kit change that breaks the probe never reaches
  npm.
- Public repo: no secrets, no internal hosts, no provider names, no roadmap in code or docs.

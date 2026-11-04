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
- `manifest/` the Zod manifest (`package.json` `agentage` key), parts normalization, reader
- `discovery/` the build record and the served discovery document
- `health/`, `server/` (the kit app, errors, listen and shutdown), `runtime/` (the image entry
  `dist/runtime/main.js <part>`), `context/` (ctx and `createTestContext`), `testing/`
- `tool/` the build tool, exported as `@agentage/extension/tool`; it must not import the server
  stack (`tool-imports.test.ts` guards it, the cli loads it)
- `index.test.ts` pins both public surfaces: authors get the envelope, schemas, `createTestContext`
  and `startTestServer`, never the server, port or record loader (sealing); the cli gets `build`
  and `buildLines`
- `schemas/` JSON Schema generation; `test-support/` fixtures, excluded from the build

## Layout (`packages/widget`)

- `src/host/` the bridge: `useHost`, `tool` (2026-07-28 `tools/call` over `POST /mcp`), `api`
- `src/ds/` `Button`, `Card` and the sheet: `widget.css` compiled by `scripts/build-css.mjs` into
  the gitignored `styles.generated.ts` (`npm run css`, run by type-check, test and build);
  `@property` goes to the document, the rest is adopted per shadow root
- `src/register/` `registerWidgets`, the element (`defineWidget`, internal), the error box
- `src/bundle/` the bundler and the `agentage-widget` bin; `src/harness/` the harness page logic
  (bundled to `dist/ui/harness.js`; the template is `harness/harness.html`)
- `e2e/` Playwright: bundles the fixture, serves it under the ui CSP with a stub `/mcp`, light
  and dark screenshots; `src/test-support/fixture` is the probe's echo widget (C7 text)

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
- Kit 0.1 serves and builds the api part only; other parts fail loudly in `build` and `runPart`.
- CI's image smoke clones extension-probe master and installs the packed kit into it: a probe
  change can turn this CI red, and a kit change that breaks the probe never reaches npm.
- Public repo: no secrets, no internal hosts, no provider names, no roadmap in code or docs.

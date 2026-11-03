# CLAUDE.md - agentage/platform

Public repo. The extension kit and its build tool; no product code. Standards: the engineering
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

## Gotchas

- `express` is an optional peer: extensions declare it, the cli (tool only) does not get it.
- The record is mounted into the container at deploy time: an image cannot carry its own digest.
- `/health` checks the socket's local address, so a published Docker port answers 404 by design;
  use `--network host` or `docker exec` to read it.
- Kit 0.1 serves and builds the api part only; other parts fail loudly in `build` and `runPart`.
- Public repo: no secrets, no internal hosts, no provider names, no roadmap in code or docs.

# platform

Everything an agentage extension author imports or runs, and no product code. Two packages:

- [`@agentage/extension`](packages/extension): the extension kit (a part exports only
  `create(ctx)`; the kit owns the server, `/health`, discovery, the correlation id and the response
  envelope) and its build tool (one image per part from the kit's recipe, pushed to GitHub
  Container Registry, with a build record of the image digests).
- [`@agentage/widget`](packages/widget): the ui part. React widgets as custom elements in a
  shadow root, the host bridge (`useHost`), design-system `Button` and `Card`, and the bundler
  with its harness page.

## Install

```bash
npm ci
npm run build
```

## Write an api part

```ts
// src/api/index.ts of an extension package; the kit mounts it at /api/v1/
import { Router } from 'express';
import { ok, parse, type PartContext } from '@agentage/extension';
import { z } from 'zod';

const EchoQuery = z.object({ msg: z.string().min(1) });

export const create = (_ctx: PartContext): Router => {
  const router = Router();
  router.get('/echo', (req, res) => {
    const { msg } = parse(EchoQuery, req.query);
    res.json(ok({ msg }));
  });
  return router;
};
```

The manifest is the `agentage` block of the extension's `package.json`:

```json
{
  "name": "@agentage/extension-probe",
  "version": "0.1.0",
  "engines": { "agentage": "^0.1" },
  "agentage": { "id": "probe", "parts": { "api": true } }
}
```

Unit tests run the part inside the kit's real app: `startTestServer({ create, ctx: createTestContext() })`.

## Build the images

```bash
node packages/extension/dist/tool/cli.js build --dir ../extension-probe          # build only
node packages/extension/dist/tool/cli.js build --dir ../extension-probe --push   # push + record
```

`build` validates the manifest, runs the package's `npm run build`, then builds one image per part
from the kit recipe (multi-stage `node:26-alpine`, `npm ci --omit=dev`, `USER node`,
`COMMIT_SHA`/`BUILD_TIME` as `ENV`, a `HEALTHCHECK` on `127.0.0.1`) tagged
`ghcr.io/agentage/{id}-{part}:{version}`, with the OCI labels `org.opencontainers.image.revision`
(the full commit sha) and `org.opencontainers.image.created`. `--push` pushes each image and writes
`dist/agentage-extension.json`, the build record with every image by digest. `--registry` points at
another registry (a local one for tests). The cli runs the same code as `agentage extension build`
through the `@agentage/extension/tool` exports.

## Run a part image

|                                        |                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port                                   | `3000` (`PORT` overrides)                                                                                                                                        |
| `/health`                              | answers on loopback only (the container `HEALTHCHECK`, an operator inside the node); `404` from any other address                                                |
| `/.well-known/agentage-extension.json` | the build record mounted at `/run/agentage/agentage-extension.json` (`AGENTAGE_RECORD_FILE` overrides) plus the host; without a record it lists the image by tag |
| `AGENTAGE_ORIGIN`                      | the deployment's origin, e.g. `https://probe.example.com`; else taken from the request                                                                           |

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
`/api/v1{path}`. Its token: `?token=` wins; on `localhost` or `127.0.0.1` it asks the dev issuer
at `http://localhost:4281/token` for `{id}:read`; else it calls anonymously. The token stays in
the bridge. The page has no inline script, so it runs under the ui part's CSP.

A shell mounts a widget by setting the element's `host` before it connects; without one the
element uses `globalThis.__agentageHost?.(element)`, else an anonymous same-origin bridge.

## Verify

```bash
npm run verify
npm run test:e2e      # widget harness and screenshots, Chromium; baselines come from the CI container
```

## Release

A `v*` tag (or a manual dispatch) runs `.github/workflows/release.yml`, which publishes every
package version not yet on npm with OIDC trusted publishing and provenance. Before that, CI builds
[extension-probe](https://github.com/agentage/extension-probe) on the packed kit and runs its smoke
suite against the image, so a kit change is proven in a container before it ships.

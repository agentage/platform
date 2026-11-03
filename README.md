# platform

Everything an agentage extension author imports or runs, and no product code. Today it holds one
package, [`@agentage/extension`](packages/extension): the extension kit (a part exports only
`create(ctx)`; the kit owns the server, `/health`, discovery, the correlation id and the response
envelope) and its build tool (one image per part from the kit's recipe, pushed to GitHub Container
Registry, with a build record of the image digests).

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

## Verify

```bash
npm run verify
```

## Release

A `v*` tag runs `.github/workflows/release.yml`, which publishes every package version not yet on
npm with OIDC trusted publishing and provenance.

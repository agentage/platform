# The tool: build, up, token

Words used here:

- **Record**: the build file that lists a release's images by digest (`.agentage/record.json`).
- **Sealing**: the check rule that part code may not read `process.env`, call `listen()` or name an absolute agentage URL.

The paths below are relative to the root of this repo. `--dir <ext>` names the extension folder.
The default is the current folder. Inside an extension, `npx agentage extension <command>` runs the
same tool. `build` and `up` need Docker. The extension must be a git checkout with a commit.

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

Every docker, git and npm call has a timeout (`tool/timeouts.ts`). No call retries, so a re-run
is safe. The cli runs the same code as `agentage extension check|build|up|down|token` through
`@agentage/extension/tool`.

# @agentage/extension

The agentage extension kit. Each part module (pages, api, mcp, worker, cli) exports only
`create(ctx)`; the kit owns the server, port, `/health`, the discovery document, the `agcid`
correlation id, the response envelope, the store pool, the scheduler and argument parsing.
`@agentage/extension/tool` is the tool behind `agentage extension build | up | down | token`.
`@agentage/extension/logs` is the event line (`EventSchema`, `parseLine`, `createLogger`,
`createEventsClient`, `KINDS`, `LEVELS`, `USER_TYPES`), built into the kit's own tarball.

```bash
npm install @agentage/extension express zod
```

`agentage extension check [dir] --json` prints the conformance report (exit 1 when `conforms` is
false); `file` and `line` are there only when a problem has them:

```json
{
  "id": "probe",
  "version": "0.4.0",
  "conforms": false,
  "rules": ["manifest", "entries", "surface", "stack", "store", "sealing"],
  "problems": [
    { "rule": "sealing", "file": "src/api/index.ts", "line": 7, "problem": "reads process.env" }
  ],
  "skipped": {}
}
```

Secrets: `agentage.secrets` lists names, never values. A plain name is mounted in every part
but ui; `{ "name": "github-app-key", "parts": ["worker"] }` only in the parts it names. Any
other part starts without it, and a read of `ctx.secrets.githubAppKey` there throws. A test
takes a part's view with `createTestContext({ extension: { part: 'worker' } })`.

See the [platform README](https://github.com/agentage/platform#readme) for every part kind, the
manifest, the tool and how a part image runs.

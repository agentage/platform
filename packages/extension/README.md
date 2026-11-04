# @agentage/extension

The agentage extension kit. Each part module (pages, api, mcp, worker, cli) exports only
`create(ctx)`; the kit owns the server, port, `/health`, the discovery document, the `agcid`
correlation id, the response envelope, the store pool, the scheduler and argument parsing.
`@agentage/extension/tool` is the tool behind `agentage extension build | up | down | token`.

```bash
npm install @agentage/extension express zod
```

See the [platform README](https://github.com/agentage/platform#readme) for every part kind, the
manifest, the tool and how a part image runs.

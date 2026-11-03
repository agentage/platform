# @agentage/extension

The agentage extension kit. A part module exports only `create(ctx)`; the kit owns the server,
port, `/health`, the discovery document, the `agcid` correlation id and the response envelope.
`@agentage/extension/tool` is the build tool behind `agentage extension build`.

```bash
npm install @agentage/extension express zod
```

See the [platform README](https://github.com/agentage/platform#readme) for the api part, the
manifest, the build tool and how a part image runs.

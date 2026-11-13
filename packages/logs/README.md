# @agentage/logs

Private: this package is not on npm. The kit builds this code into its own tarball as
`vendor/logs` and re-exports it, so import it as `@agentage/extension/logs` (same names as below).
The release skips private packages.

The agentage event line: one JSON line per unit of work (`http`, `mcp`, `job`, `span`, `error`,
`event`, `log`), written to stderr by every part and shipped by the host.

```ts
import { createLogger, createEventsClient, EventSchema, parseLine } from '@agentage/logs';

const log = createLogger({ extension: 'probe', part: 'api', version: '0.6.0' });
log.info('ready');
log.http({ method: 'GET', route: '/api/v1/items/{id}', status: 200, ms: 12 });
await log.span('store.query', () => query());
log.error(new Error('forced'), '/api/v1/emit');

await createEventsClient({ url: 'https://logs.example', token }).post([
  {
    kind: 'event',
    msg: 'e2e.result',
    extension: 'e2e',
    part: 'reporter',
    fields: { 'event.name': 'e2e.result' },
  },
]);
```

Names inside `fields` follow OpenTelemetry where a stable name exists (`http.route`,
`exception.type`), `agentage.*` otherwise.

Redaction and limits:

- A key that matches `token|secret|password|key|authorization|cookie` is redacted.
- A string that holds a JWT, an `aga_` token (16 or more characters after the prefix) or a
  `Bearer` value becomes `[redacted]`.
- Strings are cut at 200 characters and nesting at depth 3.

MIT.

# @agentage/logs

Private for now: not on npm until the owner bootstraps the package there (a trusted publisher for
`release.yml`); then `"private": true` goes. Until then the kit builds this code into its own
tarball and re-exports it, so import it as `@agentage/extension/logs` (same names as below).

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
`exception.type`), `agentage.*` otherwise. Keys that look like credentials are redacted, strings
are cut at 200 characters and nesting at depth 3. MIT.

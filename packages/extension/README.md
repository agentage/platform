# @agentage/extension

The agentage extension kit. Each part module (pages, api, mcp, worker, cli) exports only
`create(ctx)`; the kit owns the server, port, `/health`, the discovery document, the `agcid`
correlation id, the response envelope, the store pool, the scheduler and argument parsing.
`@agentage/extension/tool` is the tool behind `agentage extension build | up | down | token`.

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

The pages part's `create(ctx)` returns a site map, path to file text. Each file goes out with the
type of its extension (`.js`/`.mjs` as `text/javascript`, `.css`, `.json`, `.svg`, `.png`,
`.ico`; anything else as HTML), so a page can load its own ES module. Pages and ui send one CSP:

```text
default-src 'self'; script-src 'self' https://*.<parent>;
connect-src 'self' <AGENTAGE_ISSUER origin> https://*.<parent>; img-src 'self' data:;
style-src 'self' 'unsafe-inline'
```

`<parent>` is the part's own host (`AGENTAGE_ORIGIN`) minus its first label
(`fixture.next.agentage.io` -> `next.agentage.io`); there is no wildcard for a one-label host,
a bare domain or an IP, so under `up` (`localhost`) a page reaches only itself (a widget also the dev issuer).

See the [platform README](https://github.com/agentage/platform#readme) for every part kind, the
manifest, the tool and how a part image runs.

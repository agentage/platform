# @agentage/shell

The agentage shell kit. A shell page reads what its target runs from root, then mounts each
extension's widgets by the layout: it imports the widget module from the extension's discovery,
creates the element, gives it the host and places it.

```bash
npm install @agentage/shell @agentage/widget
```

```ts
import { mountWidgets, readInstallation } from '@agentage/shell';
import { createBridge } from '@agentage/widget';

const { installation: doc } = await readInstallation('https://agentage.io', target, { token });
const layout = doc.routes[location.pathname] ?? doc.routes['/'];
await mountWidgets(layout, {
  host: (deployment) => createBridge({ baseUrl: deployment.url, token }),
  container: document.getElementById('shell')!,
  deployments: doc.deployments,
});
```

## The calls

| Call                                                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readInstallation(rootUrl, target, { token?, fetch? })`                         | `GET {rootUrl}/api/v1/installations/{target}`, reads the `{ success, data }` envelope, validates `data` and resolves `{ installation, etag }` (`etag` from the `ETag` header, `undefined` when root sends none). Rejects on an HTTP error or a document outside the shape. Until root exists (2.1) a static document of the same shape serves.                                                                                                                                                                                                                                      |
| `readOverlay(rootUrl, target, { token, fetch? })`                               | `GET .../installations/{target}/overlay`: the caller's own route changes on that target, `{ overlay, etag }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `writeOverlay(rootUrl, target, overlay, { token, ifMatch, fetch? })`            | `PUT .../installations/{target}/overlay` with `If-Match: ifMatch`; resolves the stored `{ overlay, etag }`. A stale `ifMatch` rejects with `PRECONDITION_FAILED` (412).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mountWidgets(layout, { host, container, deployments, importModule?, fetch? })` | Takes the layout of one route. Builds the layout boxes in `container` in layout order. For each widget node it reads `{deployment.url}/.well-known/agentage-extension.json` (once per deployment), finds the widget by `name`, imports its `module`, creates its `element`, sets `el.host` to `host(deployment)` (called once per deployment) and puts it in its place. Resolves the placed elements; never rejects: a widget that fails becomes one `<p role="alert">` with the reason. `importModule(url)` (default `import(url)`) and `fetch` (default the global) are optional. |

## The installation document

```json
{
  "target": "fixture.next.agentage.io",
  "deployments": [{ "id": "probe", "url": "https://probe.next.agentage.io" }],
  "routes": {
    "/": {
      "kind": "column",
      "children": [
        { "kind": "widget", "extension": "probe", "name": "echo" },
        { "kind": "row", "children": [{ "kind": "widget", "extension": "probe", "name": "clock" }] }
      ]
    },
    "/settings": { "kind": "widget", "extension": "probe", "name": "echo" }
  }
}
```

`routes` maps a path (starting with `/`, at most 64 characters) to the layout of that route;
a shell page mounts `routes[location.pathname] ?? routes['/']`. An overlay is `{ "routes": { ... } }` with the same keys: a route present in the overlay replaces
that route's layout in the installation. A layout node is `{ "kind": "row" | "column", "children": [...] }` (nests) or
`{ "kind": "widget", "extension", "name" }`, where `extension` is a deployment `id`. A row or
column is a flex box with `data-layout` set to its kind.

Every call sends `credentials: 'omit'` and, with a `token` (a `() => Promise<string | undefined>`,
such as `createIdentity(...).token()`), `Authorization: Bearer <token>`. A failure rejects with a
`ShellError`: `name`, `code` (root's error code, else `HTTP_<status>`), `message`, `status` and
`agcid` when root sent one.

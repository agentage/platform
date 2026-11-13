# platform

The kit for writing an agentage extension. Authors of extensions use it; so do the cli and the
shell pages that run them. It holds no product code.

Words used here:

- **Extension**: one npm package whose `package.json` has an `agentage` block (the manifest).
- **Part**: one folder of an extension: `pages`, `ui`, `api`, `mcp`, `worker` or `cli`. It exports only `create(ctx)`.
- **Kit**: the library that runs a part. `@agentage/extension` is the kit; it owns servers, ports, `/health`, discovery, the envelope, the store and the scheduler.
- **Tool**: the build and local-run program in the kit (`build`, `up`, `down`, `token`). The cli runs it as `agentage extension ...`.
- **agcid**: the request id. It is 32 hex characters.

## Packages

- [`@agentage/extension`](packages/extension): the extension kit and its tool (one image per part).
- [`@agentage/logs`](packages/logs): the event line: one JSON row per unit of work on stderr.
  It is private: the kit ships it inside its own tarball. Import it from `@agentage/extension/logs`.
- [`@agentage/widget`](packages/widget): the `ui` part. React widgets as custom elements, the host
  bridge (`useHost`), `Button` and `Card`, and the bundler with its harness page.
- [`@agentage/shell`](packages/shell): the shell kit. `readInstallation` reads what a target runs.
  `mountWidgets` places each extension's widgets by the layout of a route.
- [`@agentage/identity`](packages/identity): the identity client for browser pages. Sign in at
  auth, get a one-hour token for the parts, `mintToken`, `revokeToken`, sign out.

## Work on this repo

```bash
npm ci
npm run build
npm run verify
```

## Write a widget

`src/ui/index.ts` exports `widgets = { echo: Echo }`, each a React component. The full API, the
import table and the harness page are in [`packages/widget`](packages/widget/README.md).

## Verify

```bash
npm run verify
npm run test:e2e
```

`test:e2e` runs the widget harness in Chromium with an axe WCAG A/AA sweep and screenshots in both
themes. Baselines come from the CI container image.

## Release

A `v*` tag, or a manual dispatch, runs `.github/workflows/release.yml`. It publishes every package
version not yet on npm, using OIDC trusted publishing with provenance, and skips private packages.

Before that, CI builds [extension-probe](https://github.com/agentage/extension-probe) on the
packed packages, runs `up`, and checks every part image and the served discovery document. A kit
change is proven in containers before it ships.

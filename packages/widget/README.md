# @agentage/widget

The agentage widget kit. An extension's `src/ui/index.ts` exports a map of React components; the
kit registers each as the custom element `{id}-{name}` with an open shadow root, the
design-system sheet adopted into it and its own error box. `useHost()` gives a widget its own
tools and REST, never a token. `agentage-widget bundle` builds the ui part and a harness page.

```bash
npm install -D @agentage/widget
npm install react react-dom
```

```tsx
// src/ui/echo.tsx
import { useState } from 'react';
import { useHost } from '@agentage/widget';
import { Button, Card } from '@agentage/widget/ds';

export function Echo() {
  const { tool } = useHost();
  const [answer, setAnswer] = useState('');
  return (
    <Card title="probe">
      <Button onClick={async () => setAnswer((await tool('probe__echo', { msg: 'hi' })).msg)}>
        ping
      </Button>
      <p>{answer}</p>
    </Card>
  );
}

// src/ui/index.ts
export const widgets = { echo: Echo };

// src/ui/tools.ts: types the tool answers
declare module '@agentage/widget' {
  interface ToolOutputs {
    probe__echo: { msg: string };
  }
}
```

```bash
npx agentage-widget bundle            # dist/ui/{id}.js, widgets.json, harness.html, harness.js
```

A host element's `data-theme="light"` or `"dark"` decides the theme, set by a shell at any time;
without it the system `prefers-color-scheme` decides. `useHost().context` carries `theme` and
`props` (`{}` by default). A shell builds the host for a deployment with
`createBridge({ baseUrl, token })` and sets `el.host` before it appends the element. The harness
page takes `?theme=light|dark`, `?widget=`, `?token=` and `?scope=` (the dev token's scope,
default `{id}:read`).

The root export also has `hostError(code, message)` (the error a bridge call throws),
`EnvelopeSchema` (the `{ success, data | error }` reply a bridge parses) and the types `FetchLike`
and `TokenSource`. The `@agentage/widget/register` subpath has `registerWidgets(id, widgets)`:
a shell page calls it with a loaded bundle's map to define the elements.

See the [platform README](https://github.com/agentage/platform#readme) for the bridge protocol
and the harness page.

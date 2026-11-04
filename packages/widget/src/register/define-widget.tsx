import { type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { adoptWidgetStyles } from '../ds/sheet.js';
import { HostProvider } from '../host/use-host.js';
import { type Host } from '../host/host.types.js';
import { resolveHost } from './resolve-host.js';
import { WidgetError } from './widget-error.js';

export interface WidgetSpec {
  id: string;
  element: string;
  version: string;
  component: ComponentType;
}

const mount = (shadow: ShadowRoot, spec: WidgetSpec, host: Host): Root => {
  const container = shadow.ownerDocument.createElement('div');
  shadow.append(container);
  const { component: Component, element } = spec;
  // The widget's own root is its error boundary: a throw replaces only this box.
  const root: Root = createRoot(container, {
    onUncaughtError: (error) => {
      console.error(`[${element}]`, error);
      queueMicrotask(() => root.render(<WidgetError element={element} error={error} />));
    },
  });
  root.render(
    <HostProvider host={host}>
      <Component />
    </HostProvider>
  );
  return root;
};

export const defineWidget = (spec: WidgetSpec): CustomElementConstructor =>
  class AgentageWidget extends HTMLElement {
    host?: Host;
    #root?: Root;

    connectedCallback(): void {
      if (this.#root) return;
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      adoptWidgetStyles(shadow);
      this.#root = mount(shadow, spec, resolveHost(this, spec.id, spec.version));
    }

    disconnectedCallback(): void {
      // A move fires disconnect then connect in one task; unmount only when really gone.
      queueMicrotask(() => {
        if (this.isConnected || !this.#root) return;
        this.#root.unmount();
        this.#root = undefined;
        this.shadowRoot?.replaceChildren();
      });
    }
  };

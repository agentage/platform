import { type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { adoptWidgetStyles } from '../ds/sheet.js';
import { HostProvider } from '../host/use-host.js';
import { type Host } from '../host/host.types.js';
import { currentTheme } from '../host/theme.js';
import { resolveHost } from './resolve-host.js';
import { WidgetError } from './widget-error.js';

export interface WidgetSpec {
  id: string;
  element: string;
  version: string;
  component: ComponentType;
}

const mount = (shadow: ShadowRoot, element: string): Root => {
  const container = shadow.ownerDocument.createElement('div');
  shadow.append(container);
  // The widget's own root is its error boundary: a throw replaces only this box.
  const root: Root = createRoot(container, {
    onUncaughtError: (error) => {
      console.error(`[${element}]`, error);
      queueMicrotask(() => root.render(<WidgetError element={element} error={error} />));
    },
  });
  return root;
};

// The widget sees its element's theme, its own id and version, and props {} when none is given.
const viewOf = (host: Host, element: Element, spec: WidgetSpec): Host => {
  const { extension, version, props } = host.context;
  const theme = currentTheme(element);
  const own = { extension: extension || spec.id, version: version || spec.version, theme };
  const context = { ...host.context, ...own, props: props ?? {} };
  return { tool: host.tool.bind(host), api: host.api.bind(host), context };
};

const render = (root: Root, { component: Component }: WidgetSpec, host: Host): void =>
  root.render(
    <HostProvider host={host}>
      <Component />
    </HostProvider>
  );

export const defineWidget = (spec: WidgetSpec): CustomElementConstructor =>
  class AgentageWidget extends HTMLElement {
    static observedAttributes = ['data-theme'];
    host?: Host;
    #root?: Root;
    #host?: Host;

    connectedCallback(): void {
      if (this.#root) return;
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      adoptWidgetStyles(shadow);
      this.#host = resolveHost(this, spec.id, spec.version);
      this.#root = mount(shadow, spec.element);
      this.#render();
    }

    // A theme toggle on the element re-renders the widget with the new context.theme.
    attributeChangedCallback(): void {
      this.#render();
    }

    #render(): void {
      if (this.#root && this.#host) render(this.#root, spec, viewOf(this.#host, this, spec));
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

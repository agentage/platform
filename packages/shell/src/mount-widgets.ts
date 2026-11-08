import type { Host } from '@agentage/widget';
import {
  DiscoverySchema,
  type Deployment,
  type Discovery,
  type Layout,
  type WidgetNode,
} from './installation.schema.js';
import { getJson, trimSlash } from './read-installation.js';

export interface MountOptions {
  host: (deployment: Deployment) => Host;
  container: Element;
  deployments: Deployment[];
  importModule?: (url: string) => Promise<unknown>;
}

interface Slot {
  node: WidgetNode;
  slot: Element;
}

type HostedElement = HTMLElement & { host?: Host };

type ReadDiscovery = (url: string) => Promise<Discovery>;

type HostFor = (deployment: Deployment) => Host;

interface Mount {
  options: MountOptions;
  read: ReadDiscovery;
  hostFor: HostFor;
}

// The only import(): tests inject importModule, and bundlers leave a runtime URL alone.
const nativeImport = (url: string): Promise<unknown> => import(url);

// Boxes and one placeholder per widget, synchronously, so the page order is the layout order.
const place = (layout: Layout, parent: Element, slots: Slot[]): void => {
  const doc = parent.ownerDocument;
  if (layout.kind === 'widget') {
    const slot = parent.appendChild(doc.createElement('div'));
    slots.push({ node: layout, slot });
    return;
  }
  const box = parent.appendChild(doc.createElement('div'));
  box.dataset.layout = layout.kind;
  box.style.display = 'flex';
  box.style.flexDirection = layout.kind;
  for (const child of layout.children) place(child, box, slots);
};

const discoveryReader = (): ReadDiscovery => {
  const cache = new Map<string, Promise<Discovery>>();
  return (url: string): Promise<Discovery> => {
    const wellKnown = `${trimSlash(url)}/.well-known/agentage-extension.json`;
    if (!cache.has(wellKnown)) cache.set(wellKnown, getJson(wellKnown).then(DiscoverySchema.parse));
    return cache.get(wellKnown) as Promise<Discovery>;
  };
};

const resolveWidget = async (node: WidgetNode, { options, read }: Mount) => {
  const deployment = options.deployments.find((d) => d.id === node.extension);
  if (!deployment) throw new Error(`no deployment for ${node.extension}`);
  const widget = (await read(deployment.url)).widgets?.find((w) => w.name === node.name);
  if (!widget) throw new Error(`${node.extension} serves no widget ${node.name}`);
  return { ...widget, deployment, module: new URL(widget.module, deployment.url).href };
};

// One host per deployment id for the whole mount, so its widgets share one bridge.
const hostCache = (make: MountOptions['host']): HostFor => {
  const hosts = new Map<string, Host>();
  return (d) => {
    if (!hosts.has(d.id)) hosts.set(d.id, make(d));
    return hosts.get(d.id) as Host;
  };
};

// Import first, then create and set host, then connect: an upgrade after .host would reset it.
const mountOne = async ({ node, slot }: Slot, mount: Mount) => {
  const widget = await resolveWidget(node, mount);
  await (mount.options.importModule ?? nativeImport)(widget.module);
  if (!customElements.get(widget.element))
    throw new Error(`${widget.module} defines no ${widget.element}`);
  const el: HostedElement = slot.ownerDocument.createElement(widget.element);
  el.host = mount.hostFor(widget.deployment);
  slot.replaceWith(el);
  return el;
};

const showError = ({ node, slot }: Slot, error: unknown): Element => {
  const box = slot.ownerDocument.createElement('p');
  box.setAttribute('role', 'alert');
  box.dataset.widgetError = `${node.extension}/${node.name}`;
  box.textContent = `${node.extension} ${node.name}: ${error instanceof Error ? error.message : String(error)}`;
  slot.replaceWith(box);
  return box;
};

// Never rejects: a widget that fails becomes its own error element.
export const mountWidgets = async (layout: Layout, options: MountOptions): Promise<Element[]> => {
  const slots: Slot[] = [];
  options.container.replaceChildren();
  place(layout, options.container, slots);
  const mount = { options, read: discoveryReader(), hostFor: hostCache(options.host) };
  return Promise.all(slots.map((s) => mountOne(s, mount).catch((e: unknown) => showError(s, e))));
};

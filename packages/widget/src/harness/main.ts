import { createBridge } from '../host/bridge.js';
import { readConfig } from './config.js';
import { loadWidgets, mountWidgets, pickWidgets, showProblem } from './mount.js';
import { resolveToken } from './token.js';

const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);

// Keeps a ?token= out of the address bar once it is read.
const dropTokenFromUrl = (): void => {
  const url = new URL(location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  history.replaceState(null, '', url);
};

const start = async (target: Element): Promise<void> => {
  const config = readConfig(document, location.search);
  dropTokenFromUrl();
  const warn = (message: string) => console.warn(message);
  const input = { id: config.id, hostname: location.hostname, fetch: fetchFn, warn };
  const token = resolveToken({ ...input, token: config.token });
  const bridge = { id: config.id, version: config.version, clientName: 'agentage-harness' };
  globalThis.__agentageHost = () => createBridge({ ...bridge, token: () => token });
  await import(new URL(`./${config.id}.js`, document.baseURI).href);
  const list = await loadWidgets(fetchFn, new URL('./widgets.json', document.baseURI).href);
  mountWidgets(target, pickWidgets(list, config.widget));
};

const target = document.getElementById('widgets') ?? document.body;
start(target).catch((error: unknown) =>
  showProblem(target, `harness: ${(error as Error).message}`)
);

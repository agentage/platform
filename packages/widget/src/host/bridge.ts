import { callApi } from './api.js';
import { hostError } from './host-error.js';
import {
  type FetchLike,
  type Host,
  type HostContext,
  type TokenSource,
  type ToolOutput,
} from './host.types.js';
import { currentTheme } from './theme.js';
import { callTool } from './tool.js';
import { WIDGET_VERSION } from './version.js';

export interface BridgeOptions {
  id?: string;
  version?: string;
  baseUrl?: string;
  props?: Record<string, unknown>;
  clientName?: string;
  token?: TokenSource;
  fetch?: FetchLike;
}

const foreign = (id: string) =>
  hostError('FOREIGN_TOOL', `a ${id} widget calls only ${id}__ tools`);

// A bridge without an id (one shell host for a whole deployment) leaves the guard to its baseUrl.
const own = (id: string | undefined, name: string) => !id || name.startsWith(`${id}__`);

const anonymous: TokenSource = () => Promise.resolve(undefined);

const contextOf = (options: BridgeOptions): HostContext => ({
  extension: options.id ?? '',
  version: options.version ?? '',
  path: globalThis.location?.pathname ?? '/',
  theme: currentTheme(),
  props: options.props ?? {},
});

// POST {baseUrl}/mcp and {baseUrl}/api/v1, same origin by default; the token stays in here.
export const createBridge = (options: BridgeOptions): Host => {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  const fetchFn: FetchLike = (input, init) => (options.fetch ?? fetch)(`${base}${input}`, init);
  const token = options.token ?? anonymous;
  let lastId = 0;
  const clientInfo = { name: options.clientName ?? 'agentage-widget', version: WIDGET_VERSION };
  const tool = { fetch: fetchFn, token, clientInfo, nextId: () => ++lastId };
  return {
    // The cast is the typed view an extension declares through ToolOutputs.
    tool: <N extends string>(name: N, args: Record<string, unknown> = {}) =>
      (own(options.id, name)
        ? callTool(tool, name, args)
        : Promise.reject(foreign(options.id ?? ''))) as Promise<ToolOutput<N>>,
    api: (path, init) => callApi(fetchFn, token, path, init),
    context: contextOf(options),
  };
};

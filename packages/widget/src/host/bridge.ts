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
  id: string;
  version: string;
  clientName?: string;
  token?: TokenSource;
  fetch?: FetchLike;
}

const foreign = (id: string) =>
  hostError('FOREIGN_TOOL', `a ${id} widget calls only ${id}__ tools`);

const anonymous: TokenSource = () => Promise.resolve(undefined);

const contextOf = (id: string, version: string): HostContext => ({
  extension: id,
  version,
  path: globalThis.location?.pathname ?? '/',
  theme: currentTheme(),
});

// Same-origin bridge: POST /mcp and /api/v1; the token, when any, stays in here.
export const createBridge = (options: BridgeOptions): Host => {
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const token = options.token ?? anonymous;
  let lastId = 0;
  const clientInfo = { name: options.clientName ?? 'agentage-widget', version: WIDGET_VERSION };
  const tool = { fetch: fetchFn, token, clientInfo, nextId: () => ++lastId };
  return {
    // The cast is the typed view an extension declares through ToolOutputs.
    tool: <N extends string>(name: N, args: Record<string, unknown> = {}) =>
      (name.startsWith(`${options.id}__`)
        ? callTool(tool, name, args)
        : Promise.reject(foreign(options.id))) as Promise<ToolOutput<N>>,
    api: (path, init) => callApi(fetchFn, token, path, init),
    context: contextOf(options.id, options.version),
  };
};

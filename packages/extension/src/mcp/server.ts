import { McpServer } from '@modelcontextprotocol/server';
import { agcidOf } from '../agcid/agcid.js';
import { currentAgcid } from '../agcid/current.js';
import { fail, isFailure, type Failure } from '../envelope/envelope.js';
import { type Log } from '../log/log.js';
import { prefixed, type ToolEntry } from './tools.js';

export interface ServerIdentity {
  id: string;
  version: string;
}

const text = (value: string) => [{ type: 'text' as const, text: value }];

// A failed tool: isError, the REST error shape, an agcid (minted outside a request); else INTERNAL.
const errorResult = (err: unknown, log: Log, tool: string) => {
  const failure: Failure = isFailure(err) ? err : fail('INTERNAL', 'Internal error');
  if (failure.status >= 500) log.error(err, tool);
  const error = { code: failure.code, message: failure.message, agcid: agcidOf(currentAgcid()) };
  return { isError: true, content: text(error.message), structuredContent: { error } };
};

// The kit, not the SDK, refuses bad arguments (C7): the SDK lists the schema, passes all through.
const listedOnly = (input: ToolEntry['spec']['input']) => ({
  '~standard': { ...input['~standard'], validate: (value: unknown) => ({ value }) },
});

const argsOf = (entry: ToolEntry, args: Record<string, unknown>) => {
  const parsed = entry.spec.input.safeParse(args);
  if (parsed.success) return parsed.data;
  const fields = new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'));
  throw fail('VALIDATION_ERROR', `Invalid arguments: ${[...fields].join(', ')}`);
};

const callback =
  (entry: ToolEntry, log: Log, tool: string) => async (args: Record<string, unknown>) => {
    const start = performance.now();
    const ms = () => Math.round(performance.now() - start);
    try {
      const output = entry.spec.output.parse(await entry.handler(argsOf(entry, args)));
      log.mcp({ tool, ms: ms() });
      const content = text(JSON.stringify(output));
      return { content, structuredContent: output as Record<string, unknown> };
    } catch (err) {
      // A 4xx is a rejection, not a failure: the row stays info.
      log.mcp({ tool, ms: ms(), ...(isFailure(err) && err.status < 500 ? {} : { error: err }) });
      return errorResult(err, log, tool);
    }
  };

// One fresh server per request (stateless); serverInfo agentage-{id} at the package version.
export const serverFactory = (identity: ServerIdentity, tools: ToolEntry[], log: Log) => () => {
  const server = new McpServer({ name: `agentage-${identity.id}`, version: identity.version });
  for (const entry of tools) {
    const config = {
      description: entry.spec.description,
      inputSchema: listedOnly(entry.spec.input),
      outputSchema: entry.spec.output,
    };
    const tool = prefixed(identity.id, entry.name);
    server.registerTool(tool, config, callback(entry, log, tool));
  }
  return server;
};

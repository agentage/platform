import { McpServer } from '@modelcontextprotocol/server';
import { currentAgcid } from '../agcid/current.js';
import { fail, isFailure, type Failure } from '../envelope/envelope.js';
import { type Log } from '../log/log.js';
import { prefixed, type ToolEntry } from './tools.js';

export interface ServerIdentity {
  id: string;
  version: string;
}

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

// A failed tool is isError with the REST error shape; anything unexpected is a generic INTERNAL.
const errorResult = (err: unknown, log: Log) => {
  const failure: Failure = isFailure(err) ? err : fail('INTERNAL', 'Internal error');
  if (failure.status >= 500) log.error(err);
  const error = { code: failure.code, message: failure.message, agcid: currentAgcid() ?? '' };
  return { isError: true, content: text({ error }), structuredContent: { error } };
};

const callback = (entry: ToolEntry, log: Log) => async (args: Record<string, unknown>) => {
  try {
    const output = entry.spec.output.parse(await entry.handler(args));
    return { content: text(output), structuredContent: output as Record<string, unknown> };
  } catch (err) {
    return errorResult(err, log);
  }
};

// One fresh server per request (stateless); serverInfo agentage-{id} at the package version.
export const serverFactory = (identity: ServerIdentity, tools: ToolEntry[], log: Log) => () => {
  const server = new McpServer({ name: `agentage-${identity.id}`, version: identity.version });
  for (const entry of tools) {
    const config = {
      description: entry.spec.description,
      inputSchema: entry.spec.input,
      outputSchema: entry.spec.output,
    };
    server.registerTool(prefixed(identity.id, entry.name), config, callback(entry, log));
  }
  return server;
};

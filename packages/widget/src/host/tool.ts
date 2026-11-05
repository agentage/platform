import { hostError } from './host-error.js';
import { type FetchLike, type TokenSource } from './host.types.js';
import { readRpc } from './rpc-read.js';
import { timedOut, withTimeout } from './timeout.js';
import {
  TextContentSchema,
  ToolErrorSchema,
  ToolResultSchema,
  type ToolResult,
} from './rpc.schema.js';

export const PROTOCOL_VERSION = '2026-07-28';

export interface ToolCallOptions {
  fetch: FetchLike;
  token: TokenSource;
  clientInfo: { name: string; version: string };
  nextId: () => number;
}

const requestHeaders = (name: string, token: string | undefined): Headers => {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'Mcp-Method': 'tools/call',
    'Mcp-Name': name,
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
};

const requestBody = (id: number, name: string, args: unknown, options: ToolCallOptions) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: {
    name,
    arguments: args,
    _meta: {
      'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientInfo': options.clientInfo,
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
});

const firstText = (result: ToolResult): string | undefined =>
  result.content?.map((item) => TextContentSchema.safeParse(item)).find((parsed) => parsed.success)
    ?.data?.text;

const toolFailure = (result: ToolResult): Error => {
  const parsed = ToolErrorSchema.safeParse(result.structuredContent);
  if (parsed.success) return hostError(parsed.data.error.code, parsed.data.error.message);
  return hostError('TOOL_ERROR', firstText(result) ?? 'the tool reported an error');
};

export const callTool = async (
  options: ToolCallOptions,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const id = options.nextId();
  const headers = requestHeaders(name, await options.token());
  const body = JSON.stringify(requestBody(id, name, args, options));
  const message = await options
    .fetch('/mcp', withTimeout({ method: 'POST', headers, body }))
    .then((res) => readRpc(res, id))
    .catch(timedOut(name));
  if (message.error) throw hostError(String(message.error.code), message.error.message);
  const result = ToolResultSchema.safeParse(message.result);
  if (!result.success) throw hostError('BAD_RESULT', 'the tool answered an invalid result');
  if (result.data.isError) throw toolFailure(result.data);
  return result.data.structuredContent ?? {};
};

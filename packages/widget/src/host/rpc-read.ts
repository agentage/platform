import { hostError } from './host-error.js';
import { RpcResponseSchema, type RpcResponse } from './rpc.schema.js';

const isEventStream = (res: Response): boolean =>
  (res.headers.get('content-type') ?? '').includes('text/event-stream');

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// An SSE answer carries one JSON-RPC message per data: line; the one with our id wins.
const fromEventStream = (text: string, id: number): unknown => {
  const messages = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => parseJson(line.slice(5).trim()))
    .map((message) => RpcResponseSchema.safeParse(message))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  return messages.find((message) => message.id === id) ?? messages.at(-1);
};

export const readRpc = async (res: Response, id: number): Promise<RpcResponse> => {
  const text = await res.text();
  const body = isEventStream(res) ? fromEventStream(text, id) : parseJson(text);
  const parsed = RpcResponseSchema.safeParse(body);
  if (parsed.success && (parsed.data.result !== undefined || parsed.data.error)) return parsed.data;
  throw hostError(`HTTP_${res.status}`, `MCP answered ${res.status} without a JSON-RPC message`);
};

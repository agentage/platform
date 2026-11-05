import { hostError } from './host-error.js';
import { EnvelopeSchema, RpcResponseSchema, type RpcResponse } from './rpc.schema.js';

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

// A refusal before the tool runs (401, 403, 503) is the kit's REST envelope: its code reaches the widget.
const refusal = (body: unknown, status: number): Error => {
  const envelope = EnvelopeSchema.safeParse(body);
  if (envelope.success && !envelope.data.success)
    return hostError(envelope.data.error.code, envelope.data.error.message);
  return hostError(`HTTP_${status}`, `MCP answered ${status} without a JSON-RPC message`);
};

export const readRpc = async (res: Response, id: number): Promise<RpcResponse> => {
  const text = await res.text();
  const body = isEventStream(res) ? fromEventStream(text, id) : parseJson(text);
  const parsed = RpcResponseSchema.safeParse(body);
  if (parsed.success && (parsed.data.result !== undefined || parsed.data.error)) return parsed.data;
  throw refusal(body, res.status);
};

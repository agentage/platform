import { kitFetch } from '../agcid/fetch.js';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2026-07-28'] as const;

export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

export interface McpSnapshot {
  serverInfo: { name: string; version: string };
  tools: Record<string, unknown>[];
}

type Json = Record<string, unknown>;

const CLIENT = { name: 'agentage-snapshot', version: '1.0.0' };

// Key order never counts: the two eras serialize the same schema in different orders.
export const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([key, v]) => [key, canonical(v)]));
};

// A JSON answer or the stateless legacy leg's one-message SSE stream.
const payload = async (res: Response): Promise<Json> => {
  const text = await res.text();
  if (!res.ok) throw new Error(`mcp answered ${res.status}: ${text.slice(0, 200)}`);
  const data = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? (text
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5) ?? '{}')
    : text;
  const message = JSON.parse(data) as Json;
  if (message['error']) throw new Error(`mcp error: ${JSON.stringify(message['error'])}`);
  return message['result'] as Json;
};

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': CLIENT,
  'io.modelcontextprotocol/clientCapabilities': {},
};

const post = async (url: string, version: ProtocolVersion, method: string, params: Json) => {
  const modern = version === '2026-07-28';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': version,
    ...(modern ? { 'mcp-method': method } : {}),
  };
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: modern ? { ...params, _meta: META } : params,
  };
  return payload(await kitFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }));
};

const serverInfoOf = async (url: string, version: ProtocolVersion) => {
  if (version === '2025-11-25') {
    const init = await post(url, version, 'initialize', {
      protocolVersion: version,
      capabilities: {},
      clientInfo: CLIENT,
    });
    return init['serverInfo'] as McpSnapshot['serverInfo'];
  }
  const found = await post(url, version, 'server/discover', {});
  return (found['_meta'] as Json)[
    'io.modelcontextprotocol/serverInfo'
  ] as McpSnapshot['serverInfo'];
};

// What a client of that protocol version sees: serverInfo and tools/list, canonical; the contract test diffs it.
export const mcpSnapshot = async (url: string, version: ProtocolVersion): Promise<McpSnapshot> => {
  const { name, version: serverVersion } = await serverInfoOf(url, version);
  const listed = await post(url, version, 'tools/list', {});
  return canonical({
    serverInfo: { name, version: serverVersion },
    tools: listed['tools'],
  }) as McpSnapshot;
};

// One tools/call as a stateless 2025-11-25 client sends it: the structured result, or a tool error thrown.
export const callTool = async (url: string, name: string, args: Json): Promise<unknown> => {
  const result = await post(url, '2025-11-25', 'tools/call', { name, arguments: args });
  if (result['isError']) throw new Error(`tool ${name}: ${JSON.stringify(result['content'])}`);
  return result['structuredContent'];
};

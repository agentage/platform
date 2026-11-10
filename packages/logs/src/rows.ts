import { type Fields, type Kind, type Level } from './event.schema.js';
import { MAX_STRING, stringOf } from './redact.js';

export interface Row {
  kind: Kind;
  level: Level;
  msg: string;
  fields: Fields;
}

export interface HttpRow {
  method: string;
  route: string;
  status: number;
  ms: number;
  bytes?: number;
  reason?: string;
  errorType?: string;
  // The MCP clientInfo.name an initialize sent (Q14).
  clientInfo?: string;
}

export interface McpRow {
  tool: string;
  ms: number;
  error?: unknown;
}

export interface JobRow {
  name: string;
  runId: string;
  ms: number;
  error?: unknown;
}

const HEALTH = /^\/(health|healthz|livez|readyz)$/;

const typeOf = (err: unknown): string => (err instanceof Error ? err.name : 'Error');

const failed = (err: unknown): Fields => (err === undefined ? {} : { 'error.type': typeOf(err) });

const httpLevel = (status: number, ms: number): Level =>
  status >= 500 ? 'error' : status >= 400 || ms > 1000 ? 'warn' : 'info';

// Health probes leave no row (logs-events Q2).
export const httpRow = (o: HttpRow): Row | null => {
  if (HEALTH.test(o.route)) return null;
  const route = o.route.slice(0, MAX_STRING);
  const fields: Fields = {
    'http.request.method': o.method,
    'http.route': route,
    'http.response.status_code': o.status,
    'agentage.duration_ms': o.ms,
    'agentage.bytes': o.bytes ?? 0,
    ...(o.reason ? { 'agentage.auth.reason': o.reason } : {}),
    ...(o.status >= 500 ? { 'error.type': o.errorType ?? String(o.status) } : {}),
    ...(o.clientInfo ? { 'agentage.client_info': o.clientInfo } : {}),
  };
  const msg = `${o.method} ${route} ${o.status}`;
  return { kind: 'http', level: httpLevel(o.status, o.ms), msg, fields };
};

export const mcpRow = (o: McpRow): Row => ({
  kind: 'mcp',
  level: o.error !== undefined ? 'error' : o.ms > 5000 ? 'warn' : 'info',
  msg: `${o.tool} ${o.error !== undefined ? 'failed' : 'ok'} ${o.ms}ms`,
  fields: {
    'mcp.method.name': 'tools/call',
    'gen_ai.tool.name': o.tool,
    'agentage.duration_ms': o.ms,
    ...failed(o.error),
  },
});

export const jobRow = (o: JobRow): Row => ({
  kind: 'job',
  level: o.error === undefined ? 'info' : 'error',
  msg: `${o.name} ${o.error === undefined ? 'ok' : 'failed'} ${o.ms}ms`,
  fields: {
    'agentage.job.name': o.name,
    'agentage.job.run_id': o.runId,
    'agentage.duration_ms': o.ms,
    ...failed(o.error),
  },
});

export const spanRow = (name: string, ms: number, error?: unknown): Row => ({
  kind: 'span',
  level: error !== undefined ? 'error' : ms > 1000 ? 'warn' : 'info',
  msg: `${name} ${ms}ms`,
  fields: { 'agentage.span.name': name, 'agentage.duration_ms': ms, ...failed(error) },
});

export const eventRow = (name: string, fields: Fields, msg = name): Row => ({
  kind: 'event',
  level: 'info',
  msg,
  fields: { 'event.name': name, ...fields },
});

// where: the route, tool or job; an author's agentage.fingerprint passes through (Q11 A).
export const errorRow = (err: unknown, where?: string | Fields): Row => {
  const own = typeof where === 'string' ? { 'agentage.where': where } : (where ?? {});
  const error = err instanceof Error;
  const [type, message] = error
    ? [stringOf(err.name), stringOf(err.message)]
    : ['Error', stringOf(err)];
  const stack = error ? { 'exception.stacktrace': stringOf(err.stack ?? '') } : {};
  const fields = { 'exception.type': type, 'exception.message': message, ...stack, ...own };
  return { kind: 'error', level: 'error', msg: `${type}: ${message}`, fields };
};

import { type Fields, type Kind, type Level } from './event.schema.js';

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
  fields?: Fields;
}

export interface McpRow {
  tool: string;
  ms: number;
  results?: number;
  code?: string;
  error?: unknown;
}

export interface JobRow {
  name: string;
  runId: string;
  ms: number;
  error?: unknown;
}

const HEALTH = /^\/(health|healthz|livez|readyz)$/;

export const typeOf = (err: unknown): string => (err instanceof Error ? err.name : 'Error');

const failed = (err: unknown): Fields => (err === undefined ? {} : { 'error.type': typeOf(err) });

const httpLevel = (status: number, ms: number): Level =>
  status >= 500 ? 'error' : status >= 400 || ms > 1000 ? 'warn' : 'info';

// Health probes leave no row (logs-events Q2).
export const httpRow = (o: HttpRow): Row | null => {
  if (HEALTH.test(o.route)) return null;
  const route = o.route.slice(0, 200);
  const fields: Fields = {
    'http.request.method': o.method,
    'http.route': route,
    'http.response.status_code': o.status,
    'agentage.duration_ms': o.ms,
    'agentage.bytes': o.bytes ?? 0,
    ...(o.reason ? { 'agentage.auth.reason': o.reason } : {}),
    ...(o.status >= 500 ? { 'error.type': o.errorType ?? String(o.status) } : {}),
    ...o.fields,
  };
  return {
    kind: 'http',
    level: httpLevel(o.status, o.ms),
    msg: `${o.method} ${route} ${o.status}`,
    fields,
  };
};

// A rejection (a code, no error) stays info; a failure is error; slow is warn.
export const mcpRow = (o: McpRow): Row => {
  const level = o.error !== undefined ? 'error' : o.ms > 5000 ? 'warn' : 'info';
  const fields: Fields = {
    'mcp.method.name': 'tools/call',
    'gen_ai.tool.name': o.tool,
    'agentage.duration_ms': o.ms,
    ...(o.results === undefined ? {} : { 'agentage.results': o.results }),
    ...(o.code ? { 'agentage.code': o.code } : {}),
    ...failed(o.error),
  };
  const outcome = o.error !== undefined ? 'failed' : (o.code ?? 'ok');
  return { kind: 'mcp', level, msg: `${o.tool} ${outcome} ${o.ms}ms`, fields };
};

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

// An event whose status field is not ok is an error (backup.run, deploy.run).
export const eventRow = (name: string, fields: Fields, msg = name): Row => {
  const status = Object.entries(fields).find(([key]) => key.endsWith('.status'))?.[1];
  const level = status !== undefined && status !== 'ok' ? 'error' : 'info';
  return { kind: 'event', level, msg, fields: { 'event.name': name, ...fields } };
};

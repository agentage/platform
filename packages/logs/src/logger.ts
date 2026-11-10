import { type Fields, type UserType } from './event.schema.js';
import { redact, scrub, stringOf } from './redact.js';
import {
  errorRow,
  eventRow,
  httpRow,
  jobRow,
  mcpRow,
  spanRow,
  type HttpRow,
  type JobRow,
  type McpRow,
  type Row,
} from './rows.js';

// Who and which request: the kit sets it at entry; null outside a request.
export interface RowContext {
  agcid?: string | null;
  sub?: string | null;
  session?: string | null;
  user_type?: UserType;
  client?: string | null;
}

export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(err: unknown, where?: string | Fields): void;
  http(o: HttpRow): void;
  mcp(o: McpRow): void;
  job(o: JobRow): void;
  span<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  event(name: string, fields?: Fields, msg?: string): void;
  row(row: Row): void;
}

export interface LoggerOptions {
  extension: string;
  part: string;
  version?: string;
  host?: string;
  context?: () => RowContext | undefined;
  write?: (line: string) => void;
  // Takes each row instead of writing a line (a wrapper, a test recorder).
  sink?: (row: Row) => void;
  // Fields on every row (a command's name).
  base?: Fields;
}

const timed = async <T>(fn: () => T | Promise<T>, end: (ms: number, err?: unknown) => void) => {
  const start = performance.now();
  const ms = () => Math.round(performance.now() - start);
  try {
    const value = await fn();
    end(ms());
    return value;
  } catch (err) {
    end(ms(), err);
    throw err;
  }
};

// Builds and writes a row; a row that cannot be built or written is dropped, never thrown at the caller.
const guarded =
  (row: (r: Row) => void) =>
  (build: () => Row | null): void => {
    try {
      const r = build();
      if (r) row(r);
    } catch {
      // the caller's unit of work outranks its log line
    }
  };

// Every method is a row; row is the one sink, so a wrapper replaces only it.
const loggerOf = (row: (r: Row) => void): Logger => {
  const emit = guarded(row);
  return {
    info: (msg, fields = {}) => emit(() => ({ kind: 'log', level: 'info', msg, fields })),
    warn: (msg, fields = {}) => emit(() => ({ kind: 'log', level: 'warn', msg, fields })),
    error: (err, where) => emit(() => errorRow(err, where)),
    http: (o) => emit(() => httpRow(o)),
    mcp: (o) => emit(() => mcpRow(o)),
    job: (o) => emit(() => jobRow(o)),
    span: (name, fn) => timed(fn, (ms, err) => emit(() => spanRow(name, ms, err))),
    event: (name, fields = {}, msg) => emit(() => eventRow(name, fields, msg)),
    row: (r) => emit(() => r),
  };
};

const CONTROL = /[\u0000-\u001f\u007f]/g;

// A line over this is written without its fields: a shipper splits longer lines.
export const MAX_LINE_BYTES = 64 * 1024;

// The columns the kit sets from request headers and tokens, bounded as the schema bounds them.
const columnsOf = (o: LoggerOptions, r: Row) => {
  const c = o.context?.() ?? {};
  const text = (value: string | null | undefined, max: number) =>
    value == null ? null : scrub(stringOf(value).replace(CONTROL, ''), max) || null;
  return {
    ts: new Date().toISOString(),
    level: r.level,
    kind: r.kind,
    msg: scrub(r.msg),
    extension: o.extension,
    part: o.part,
    version: o.version ?? '',
    ...(o.host ? { host: o.host } : {}),
    agcid: c.agcid ?? null,
    sub: text(c.sub, 128),
    session: text(c.session, 128),
    user_type: c.user_type ?? 'service',
    client: text(c.client, 64),
  };
};

const lineOf = (o: LoggerOptions, r: Row): string => {
  const columns = columnsOf(o, r);
  const line = JSON.stringify({
    ...columns,
    fields: { ...redact(o.base ?? {}), ...redact(r.fields) },
  });
  if (Buffer.byteLength(line) <= MAX_LINE_BYTES) return `${line}\n`;
  return `${JSON.stringify({ ...columns, fields: { 'agentage.dropped': 'fields over 64 KB' } })}\n`;
};

let quiet = false;
// A closed stderr (EPIPE) emits an error event; with no listener that would crash the part.
const stderr = (line: string): void => {
  if (!quiet) {
    process.stderr.on('error', () => undefined);
    quiet = true;
  }
  process.stderr.write(line);
};

// One JSON line per unit of work on stderr; the host ships it.
export const createLogger = (o: LoggerOptions): Logger =>
  loggerOf(o.sink ?? ((r) => (o.write ?? stderr)(lineOf(o, r))));

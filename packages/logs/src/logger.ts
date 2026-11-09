import { type Fields, type UserType } from './event.schema.js';
import { errorRow } from './error-row.js';
import { MAX_STRING, redact } from './redact.js';
import {
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

// Every method is a row; row is the one sink, so a wrapper replaces only it.
const loggerOf = (row: (r: Row) => void): Logger => ({
  info: (msg, fields = {}) => row({ kind: 'log', level: 'info', msg, fields }),
  warn: (msg, fields = {}) => row({ kind: 'log', level: 'warn', msg, fields }),
  error: (err, where) => row(errorRow(err, where)),
  http: (o) => {
    const r = httpRow(o);
    if (r) row(r);
  },
  mcp: (o) => row(mcpRow(o)),
  job: (o) => row(jobRow(o)),
  span: (name, fn) => timed(fn, (ms, err) => row(spanRow(name, ms, err))),
  event: (name, fields = {}, msg) => row(eventRow(name, fields, msg)),
  row,
});

const lineOf = (o: LoggerOptions, r: Row): string => {
  const c = o.context?.() ?? {};
  const event = {
    ts: new Date().toISOString(),
    level: r.level,
    kind: r.kind,
    msg: r.msg.slice(0, MAX_STRING),
    extension: o.extension,
    part: o.part,
    version: o.version ?? '',
    ...(o.host ? { host: o.host } : {}),
    agcid: c.agcid ?? null,
    sub: c.sub ?? null,
    session: c.session ?? null,
    user_type: c.user_type ?? 'service',
    client: c.client ?? null,
    fields: redact({ ...o.base, ...r.fields }),
  };
  return `${JSON.stringify(event)}\n`;
};

const stderr = (line: string): void => void process.stderr.write(line);

// One JSON line per unit of work on stderr; the host ships it.
export const createLogger = (o: LoggerOptions): Logger =>
  loggerOf(o.sink ?? ((r) => (o.write ?? stderr)(lineOf(o, r))));

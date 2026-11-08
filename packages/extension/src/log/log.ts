import { currentAgcid } from '../agcid/current.js';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Log {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(error: unknown, fields?: LogFields): void;
}

export interface LogTags {
  extension: string;
  part: string;
  version?: string;
  // Base fields on every line after the tags (a command's name).
  base?: LogFields;
}

export type LogWrite = (line: string) => void;

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const errorFields = (error: unknown): LogFields => {
  if (!(error instanceof Error)) return { err: { message: String(error) } };
  return { err: { type: error.name, message: error.message, stack: error.stack } };
};

// Spread twice: the key order stays, and a field never overwrites time, level, msg, tags or agcid.
const line = (level: LogLevel, message: string, tags: LogTags, fields: LogFields): string => {
  const agcid = currentAgcid();
  const ids = { 'extension.id': tags.extension, 'extension.part': tags.part };
  const version = tags.version === undefined ? {} : { version: tags.version };
  const own = { time: new Date().toISOString(), level, msg: message, ...ids, ...version };
  const fixed = agcid ? { ...own, agcid } : own;
  return `${JSON.stringify({ ...fixed, ...tags.base, ...fields, ...fixed })}\n`;
};

const stderrWrite: LogWrite = (text) => void process.stderr.write(text);

export type LineAt = (level: LogLevel, message: string, fields: LogFields) => void;

const raw = new WeakMap<Log, LineAt>();

// Registers how a Log writes a line as given, so logAt keeps every field on it.
export const withLineAt = (log: Log, at: LineAt): Log => {
  raw.set(log, at);
  return log;
};

export const createLog = (tags: LogTags, write: LogWrite = stderrWrite): Log => {
  const at: LineAt = (level, message, fields) => write(line(level, message, tags, fields));
  const log: Log = {
    info: (message, fields = {}) => at('info', message, fields),
    warn: (message, fields = {}) => at('warn', message, fields),
    error: (error, fields = {}) =>
      at('error', messageOf(error), { ...fields, ...errorFields(error) }),
  };
  return withLineAt(log, at);
};

// A line at any level with no err field (an error-level line that is not an error event).
export const logAt = (log: Log, level: LogLevel, message: string, fields: LogFields): void => {
  const at = raw.get(log);
  if (at) at(level, message, fields);
  else if (level === 'error') log.error(message, fields);
  else log[level](message, fields);
};

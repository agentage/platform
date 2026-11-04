import { currentAgcid } from '../agcid/scope.js';

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
}

export type LogWrite = (line: string) => void;

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const errorFields = (error: unknown): LogFields => {
  if (!(error instanceof Error)) return { err: { message: String(error) } };
  return { err: { type: error.name, message: error.message, stack: error.stack } };
};

// Spread twice: the key order stays, and a field never overwrites time, level, msg, tags or agcid.
const line = (level: LogLevel, message: string, tags: LogTags, fields: LogFields): string => {
  const agcid = currentAgcid();
  const own = { time: new Date().toISOString(), level, msg: message, ...tags };
  const fixed = agcid ? { ...own, agcid } : own;
  return `${JSON.stringify({ ...fixed, ...fields, ...fixed })}\n`;
};

const stderrWrite: LogWrite = (text) => void process.stderr.write(text);

export const createLog = (tags: LogTags, write: LogWrite = stderrWrite): Log => ({
  info: (message, fields = {}) => write(line('info', message, tags, fields)),
  warn: (message, fields = {}) => write(line('warn', message, tags, fields)),
  error: (error, fields = {}) =>
    write(line('error', messageOf(error), tags, { ...fields, ...errorFields(error) })),
});

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

const errorFields = (error: unknown): LogFields => {
  if (!(error instanceof Error)) return { err: { message: String(error) } };
  return { err: { type: error.name, message: error.message, stack: error.stack } };
};

const line = (level: LogLevel, message: string, tags: LogTags, fields: LogFields): string => {
  const agcid = currentAgcid();
  const entry = { time: new Date().toISOString(), level, msg: message, ...tags, ...fields };
  return `${JSON.stringify(agcid ? { ...entry, agcid } : entry)}\n`;
};

const stderrWrite: LogWrite = (text) => void process.stderr.write(text);

export const createLog = (tags: LogTags, write: LogWrite = stderrWrite): Log => ({
  info: (message, fields = {}) => write(line('info', message, tags, fields)),
  warn: (message, fields = {}) => write(line('warn', message, tags, fields)),
  error: (error, fields = {}) => {
    const message = error instanceof Error ? error.message : String(error);
    write(line('error', message, tags, { ...errorFields(error), ...fields }));
  },
});

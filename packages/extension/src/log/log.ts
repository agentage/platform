import { createLogger, type Fields, type Logger, type LoggerOptions } from '@agentage/logs';
import { requestScope } from '../agcid/current.js';

export type LogFields = Fields;

// The @agentage/logs logger: info and warn are log rows, the rest one row per unit of work.
export type Log = Logger;

// Never throws: a value with no printable form (a null-prototype object) reads [unprintable].
export const messageOf = (error: unknown): string => {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return '[unprintable]';
  }
};

export const createLog = (
  tags: Pick<LoggerOptions, 'extension' | 'part' | 'version' | 'base'>,
  write?: LoggerOptions['write']
): Log => createLogger({ ...tags, context: () => requestScope.getStore(), write });

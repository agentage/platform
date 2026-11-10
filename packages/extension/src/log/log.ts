import { createLogger, type Fields, type Logger, type LoggerOptions } from '@agentage/logs';
import { requestScope } from '../agcid/current.js';

export type LogFields = Fields;

// The @agentage/logs logger: info and warn are log rows, the rest one row per unit of work.
export type Log = Logger;

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createLog = (
  tags: Pick<LoggerOptions, 'extension' | 'part' | 'version' | 'base'>,
  write?: LoggerOptions['write']
): Log => createLogger({ ...tags, context: () => requestScope.getStore(), write });

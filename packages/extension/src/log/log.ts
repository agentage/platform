import { createLogger, type Fields, type Level, type Logger } from '@agentage/logs';
import { currentContext } from '../agcid/current.js';

export type LogLevel = Level;

export type LogFields = Fields;

// The @agentage/logs logger: info and warn are log rows, the rest one row per unit of work.
export type Log = Logger;

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

export const createLog = (tags: LogTags, write?: LogWrite): Log =>
  createLogger({ ...tags, context: currentContext, ...(write ? { write } : {}) });

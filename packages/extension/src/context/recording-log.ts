import { messageOf, type Log, type LogFields, type LogLevel } from '../log/log.js';

export interface LogEntry {
  level: LogLevel;
  message: string;
  fields: LogFields;
}

export const recordingLog = (logs: LogEntry[]): Log => ({
  info: (message, fields = {}) => void logs.push({ level: 'info', message, fields }),
  warn: (message, fields = {}) => void logs.push({ level: 'warn', message, fields }),
  error: (error, fields = {}) =>
    void logs.push({
      level: 'error',
      message: messageOf(error),
      fields: { ...fields, err: error },
    }),
});

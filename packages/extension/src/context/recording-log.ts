import { createLogger, type Level, type Row } from '@agentage/logs';
import { messageOf, type Log, type LogFields } from '../log/log.js';

export interface LogEntry {
  level: Level;
  message: string;
  fields: LogFields;
}

// The test context's log: every row as an entry; error keeps the thrown value under err.
export const recordingLog = (logs: LogEntry[]): Log => {
  const sink = ({ level, msg, fields }: Row) => void logs.push({ level, message: msg, fields });
  const log = createLogger({ extension: 'test', part: 'test', sink, strict: true });
  const error: Log['error'] = (err, where = {}) => {
    const fields = typeof where === 'string' ? { 'agentage.where': where } : where;
    logs.push({ level: 'error', message: messageOf(err), fields: { ...fields, err } });
  };
  return { ...log, error };
};

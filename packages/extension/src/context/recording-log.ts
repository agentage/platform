import { createLogger } from '@agentage/logs';
import { messageOf, type Log, type LogFields, type LogLevel } from '../log/log.js';

export interface LogEntry {
  level: LogLevel;
  message: string;
  fields: LogFields;
}

// The test context's log: every row as an entry; error keeps the thrown value under err.
export const recordingLog = (logs: LogEntry[]): Log => {
  const sink = ({ level, msg, fields }: { level: LogLevel; msg: string; fields: LogFields }) =>
    void logs.push({ level, message: msg, fields });
  const log = createLogger({ extension: 'test', part: 'test', sink });
  const error: Log['error'] = (err, where = {}) => {
    const fields = typeof where === 'string' ? { 'agentage.where': where } : where;
    logs.push({ level: 'error', message: messageOf(err), fields: { ...fields, err } });
  };
  return { ...log, error };
};

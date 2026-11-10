import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger, type Level } from '@agentage/logs';
import { messageOf, type Log } from '../log/log.js';

export const LOG_CAP_BYTES = 64 * 1024;

const TRUNCATED = '\n[log truncated at 64 KB]\n';

export interface RunBuffer {
  text: string;
  truncated: boolean;
}

const current = new AsyncLocalStorage<RunBuffer>();

export const withRunBuffer = <T>(buffer: RunBuffer, fn: () => Promise<T>): Promise<T> =>
  current.run(buffer, fn);

// Newlines kept; past the cap the rest is dropped and one marker line says so.
export const append = (buffer: RunBuffer, line: string): void => {
  if (buffer.truncated) return;
  const next = `${buffer.text}${line}\n`;
  if (Buffer.byteLength(next) <= LOG_CAP_BYTES - TRUNCATED.length) {
    buffer.text = next;
    return;
  }
  buffer.text = `${buffer.text}${TRUNCATED}`;
  buffer.truncated = true;
};

const record = (level: Level, message: string): void => {
  const buffer = current.getStore();
  if (buffer) append(buffer, `${level} ${message}`);
};

// ctx.log for a worker: the usual JSON line, and inside a run also the run's own log.
export const runLog = (base: Log): Log => ({
  ...createLogger({
    extension: 'worker',
    part: 'worker',
    sink: (row) => {
      record(row.level, row.msg);
      base.row(row);
    },
  }),
  error: (err, where) => {
    record('error', messageOf(err));
    base.error(err, where);
  },
});

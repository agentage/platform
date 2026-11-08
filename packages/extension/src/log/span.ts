import { errorFields, logAt, type Log } from './log.js';

export interface SpanRecord {
  name: string;
  ms: number;
  ok: boolean;
  err?: unknown;
}

export type Span = <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;

// One line per span; a nested span is its own line, the agcid on both links them.
export const createSpan =
  (log: Log, spans?: SpanRecord[]): Span =>
  async (name, fn) => {
    const start = performance.now();
    const end = (ok: boolean, err?: unknown): void => {
      const span = { name, ms: Math.round(performance.now() - start), ok };
      spans?.push(ok ? span : { ...span, err });
      logAt(log, ok ? 'info' : 'error', 'span', ok ? span : { ...span, ...errorFields(err) });
    };
    try {
      const value = await fn();
      end(true);
      return value;
    } catch (err) {
      end(false, err);
      throw err;
    }
  };

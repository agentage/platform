import { type Log } from './log.js';

export interface SpanRecord {
  name: string;
  ms: number;
  ok: boolean;
  err?: unknown;
}

export type Span = <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;

// One span row per call; a nested span is its own row, the agcid on both links them.
export const createSpan =
  (log: Log, spans?: SpanRecord[]): Span =>
  async (name, fn) => {
    const start = performance.now();
    const ms = () => Math.round(performance.now() - start);
    try {
      const value = await log.span(name, fn);
      spans?.push({ name, ms: ms(), ok: true });
      return value;
    } catch (err) {
      spans?.push({ name, ms: ms(), ok: false, err });
      throw err;
    }
  };

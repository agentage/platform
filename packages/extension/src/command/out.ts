import { format } from 'node:util';

export interface Out {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
  table(rows: readonly Record<string, unknown>[]): void;
  json(value: unknown): void;
  fail(code: number, message: string): void;
}

export type Write = (text: string) => void;

export interface OutOptions {
  json: boolean;
  stdout: Write;
  stderr: Write;
}

export interface RecordedOut extends Out {
  readonly exitCode: number | undefined;
}

const cell = (value: unknown): string => (typeof value === 'string' ? value : format('%o', value));

// Columns padded to the widest cell, a header row from the keys of every row.
export const tableLines = (rows: readonly Record<string, unknown>[]): string[] => {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const body = rows.map((row) => keys.map((key) => (key in row ? cell(row[key]) : '')));
  const widths = keys.map((key, i) =>
    Math.max(key.length, ...body.map((cells) => cells[i]?.length ?? 0))
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(keys), ...body.map(line)];
};

// Reads like the console; under --json stdout carries out.json only, the rest goes to stderr.
export const createOut = (options: OutOptions): RecordedOut => {
  let exitCode: number | undefined;
  const text = options.json ? options.stderr : options.stdout;
  return {
    log: (...data) => text(`${format(...data)}\n`),
    warn: (...data) => options.stderr(`${format(...data)}\n`),
    error: (...data) => options.stderr(`${format(...data)}\n`),
    table: (rows) => text(`${tableLines(rows).join('\n')}\n`),
    json: (value) => options.stdout(`${JSON.stringify(value, null, 2)}\n`),
    fail: (code, message) => {
      exitCode = code;
      options.stderr(`${message}\n`);
    },
    get exitCode() {
      return exitCode;
    },
  };
};

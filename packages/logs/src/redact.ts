import { type Fields } from './event.schema.js';

const SECRET = /token|secret|password|key|authorization|cookie/i;
export const MAX_STRING = 200;
const MAX_STACK = 2000;
const MAX_DEPTH = 3;

const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

const clean = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') return cut(value, MAX_STRING);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  const entries = Object.entries(value).map(([k, v]) => [k, keyed(k, v, depth + 1)]);
  return Object.fromEntries(entries);
};

// A stack keeps more than 200 characters: the first in-app frame is rarely in the first line.
const keyed = (key: string, value: unknown, depth: number): unknown => {
  if (SECRET.test(key)) return '[redacted]';
  if (key === 'exception.stacktrace' && typeof value === 'string') return cut(value, MAX_STACK);
  return clean(value, depth);
};

export const redact = (fields: Fields): Fields => clean(fields, 0) as Fields;

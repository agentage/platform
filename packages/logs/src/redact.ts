import { type Fields } from './event.schema.js';

const SECRET = /token|secret|password|key|authorization|cookie/i;
// A credential in a value: a JWT (also cut after its first part), an aga_ PAT, a Bearer credential.
const CREDENTIAL = /eyJ[\w-]{8,}(\.[\w-]*){0,2}|aga_[\w.-]{4,}|bearer\s+[\w.~+/=-]{16,}/gi;
export const MAX_STRING = 200;
const MAX_STACK = 2000;
const MAX_DEPTH = 3;

const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

export const stringOf = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : String(value);
  } catch {
    return '[unprintable]';
  }
};

// Masked before the cut, so the cut never leaves a credential shape half-matched.
export const scrub = (text: unknown, max = MAX_STRING): string =>
  cut(stringOf(text).replace(CREDENTIAL, '[redacted]'), max);

const read = (value: object, key: string): unknown => {
  try {
    return Reflect.get(value, key) as unknown;
  } catch {
    return '[unreadable]';
  }
};

const clean = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') return scrub(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  const entries = Object.keys(value).map((k) => [k, keyed(k, read(value, k), depth + 1)]);
  return Object.fromEntries(entries);
};

// A stack keeps more than 200 characters: the first in-app frame is rarely in the first line.
const keyed = (key: string, value: unknown, depth: number): unknown => {
  if (SECRET.test(key)) return '[redacted]';
  if (key === 'exception.stacktrace' && typeof value === 'string') return scrub(value, MAX_STACK);
  return clean(value, depth);
};

// Never throws: a getter that throws reads [unreadable], a bigint its digits, a proxy that throws empty.
export const redact = (fields: Fields): Fields => {
  try {
    return clean(fields, 0) as Fields;
  } catch {
    return { 'agentage.unreadable': true };
  }
};

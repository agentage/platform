import { uuidv7 } from '@agentage/logs';
import { TRACEPARENT_PATTERN } from './current.js';
import { isAgcid } from './header.js';

export { AGCID_HEADER, AGCID_PATTERN, isAgcid } from './header.js';
export { uuidv7 };

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO = '0'.repeat(32);

// 32 hex, or a UUID in its 8-4-4-4-12 form without the dashes; all zeros is no id (W3C).
const ownOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  const id = DASHED.test(lower) ? lower.replaceAll('-', '') : lower;
  return isAgcid(id) && id !== ZERO ? id : undefined;
};

const traceIdOf = (traceparent: unknown): string | undefined =>
  typeof traceparent === 'string' && TRACEPARENT_PATTERN.test(traceparent)
    ? ownOf(traceparent.slice(3, 35))
    : undefined;

// A valid agcid header, else the traceparent trace id, else minted.
export const agcidOf = (incoming: unknown, traceparent?: unknown): string =>
  ownOf(incoming) ?? traceIdOf(traceparent) ?? uuidv7();

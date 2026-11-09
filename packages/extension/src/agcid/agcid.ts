import { uuidv7 } from '@agentage/logs';
import { TRACEPARENT_PATTERN } from './current.js';
import { isAgcid } from './header.js';

export { AGCID_HEADER, AGCID_PATTERN, isAgcid } from './header.js';
export { uuidv7 };

const traceIdOf = (traceparent: unknown): string | undefined =>
  typeof traceparent === 'string' && TRACEPARENT_PATTERN.test(traceparent)
    ? traceparent.slice(3, 35)
    : undefined;

// A valid agcid header (a dashed UUID loses its dashes), else the traceparent trace id, else minted.
export const agcidOf = (incoming: unknown, traceparent?: unknown): string => {
  const own = typeof incoming === 'string' ? incoming.replaceAll('-', '').toLowerCase() : undefined;
  return isAgcid(own) ? own : (traceIdOf(traceparent) ?? uuidv7());
};

import { hostError } from './host-error.js';

// A hung /mcp or /api call ends here rather than leaving the widget waiting; the bridge never retries.
export const CALL_TIMEOUT_MS = 30_000;

export const withTimeout = (init: RequestInit = {}, ms = CALL_TIMEOUT_MS): RequestInit => {
  const timeout = AbortSignal.timeout(ms);
  return { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout };
};

// A timed-out call is a TIMEOUT host error naming what did not answer; anything else passes through.
export const timedOut = (what: string) => (err: unknown) => {
  if ((err as Error | null)?.name !== 'TimeoutError') throw err;
  throw hostError('TIMEOUT', `${what} did not answer in ${CALL_TIMEOUT_MS / 1000} s`);
};

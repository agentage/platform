import { vi } from 'vitest';
import { type FetchLike } from '../host/host.types.js';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export const jsonResponse = (body: unknown, status = 200, type = 'application/json'): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': type },
  });

export const fakeFetch = (...answers: Response[]) => {
  const calls: RecordedCall[] = [];
  const fetch = vi.fn<FetchLike>((url, init = {}) => {
    calls.push({ url, init });
    const answer = answers.shift();
    return answer ? Promise.resolve(answer) : Promise.reject(new Error('no more answers'));
  });
  return { fetch, calls };
};

export const toolAnswer = (result: unknown, id = 1) => jsonResponse({ result, jsonrpc: '2.0', id });

// A server that never answers: like a browser fetch, the call settles only when its signal aborts.
export const hangingFetch = () => {
  const calls: RecordedCall[] = [];
  const reached = Promise.withResolvers<void>();
  const fetch = vi.fn<FetchLike>((url, init = {}) => {
    calls.push({ url, init });
    reached.resolve();
    return new Promise<Response>((_, reject) => {
      const { signal } = init;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener('abort', () => reject(signal.reason));
    });
  });
  return { fetch, calls, called: reached.promise };
};

// AbortSignal.timeout without a clock: the test reads the bound and decides when it expires.
export const controlledTimeout = () => {
  const timer = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);
  const expire = () => timer.abort(new DOMException('The operation timed out.', 'TimeoutError'));
  return { timeout, signal: timer.signal, expire };
};

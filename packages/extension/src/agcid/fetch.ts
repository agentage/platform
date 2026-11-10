import { AGCID_HEADER, uuidv7 } from './agcid.js';
import { requestScope } from './current.js';

export const KIT_FETCH_TIMEOUT_MS = 10_000;

// Every fetch the kit makes: the scope's agcid (a fresh one outside a scope), its traceparent, a timeout.
export const kitFetch = (
  url: string,
  init: RequestInit = {},
  impl: typeof fetch = fetch
): Promise<Response> => {
  const scope = requestScope.getStore();
  const headers = new Headers(init.headers);
  headers.set(AGCID_HEADER, scope?.agcid ?? uuidv7());
  if (scope?.traceparent) headers.set('traceparent', scope.traceparent);
  const signal = init.signal ?? AbortSignal.timeout(KIT_FETCH_TIMEOUT_MS);
  return impl(url, { ...init, headers, signal });
};

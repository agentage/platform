import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestScope {
  agcid: string;
  // The incoming W3C traceparent, kept only when well formed.
  traceparent?: string;
}

// Apart from the middleware, so code the cli loads (logs, the build tool) never imports express.
export const requestScope = new AsyncLocalStorage<RequestScope>();

export const currentAgcid = (): string | undefined => requestScope.getStore()?.agcid;

export const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestScope {
  agcid: string;
}

// Apart from the middleware, so code the cli loads (logs, the build tool) never imports express.
export const requestScope = new AsyncLocalStorage<RequestScope>();

export const currentAgcid = (): string | undefined => requestScope.getStore()?.agcid;

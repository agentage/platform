import { AsyncLocalStorage } from 'node:async_hooks';
import { type RowContext } from '@agentage/logs';

// The request's agcid and who sent it; sub and session are filled once the token is checked.
interface RequestScope extends RowContext {
  agcid: string;
  // The incoming W3C traceparent, kept only when well formed.
  traceparent?: string;
  // Set by ctx.exit(): the part shuts down once this answer is sent.
  exit?: boolean;
}

// Apart from the middleware, so code the cli loads (logs, the build tool) never imports express.
export const requestScope = new AsyncLocalStorage<RequestScope>();

export const currentAgcid = (): string | undefined => requestScope.getStore()?.agcid;

export const currentContext = (): RowContext | undefined => requestScope.getStore();

export const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

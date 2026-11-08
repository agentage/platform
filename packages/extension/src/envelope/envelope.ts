import {
  DEFAULT_RETRY_AFTER_SECONDS,
  ERROR_STATUS,
  RETRY_AFTER_CODES,
  type ErrorCode,
} from './codes.js';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface OkEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  agcid: string;
  details?: ErrorDetail[];
}

export interface ErrorEnvelope {
  success: false;
  error: ErrorBody;
}

export interface Failure extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];
  readonly retryAfter?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface FailOptions {
  details?: ErrorDetail[];
  retryAfter?: number;
  // Sent with the refusal, as WWW-Authenticate on a 401 or 403 (api-standards section 5).
  headers?: Record<string, string>;
}

// A registry symbol, so a failure thrown through a second copy of the kit is still recognised.
const FAILURE = Symbol.for('agentage.extension.failure');

const REPLY = Symbol.for('agentage.extension.reply');

export interface ReplyOptions {
  meta?: Record<string, unknown>;
  etag?: string;
}

export interface Reply<T> extends ReplyOptions {
  readonly [REPLY]: true;
  data: T;
}

// What a route returns when it answers with meta or an ETag; bare data stays the short form.
export const reply = <T>(data: T, options: ReplyOptions = {}): Reply<T> => ({
  [REPLY]: true,
  data,
  ...options,
});

export const isReply = (value: unknown): value is Reply<unknown> =>
  typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[REPLY] === true;

export const ok = <T>(data: T, meta?: Record<string, unknown>): OkEnvelope<T> =>
  meta === undefined ? { success: true, data } : { success: true, data, meta };

const retryAfterOf = (code: ErrorCode, given?: number): number | undefined => {
  if (given !== undefined) return given;
  return RETRY_AFTER_CODES.includes(code) ? DEFAULT_RETRY_AFTER_SECONDS : undefined;
};

// Returned, not thrown, so a route reads `throw fail(...)`; the kit turns it into the envelope.
export const fail = (code: ErrorCode, message: string, options: FailOptions = {}): Failure =>
  Object.assign(new Error(message), {
    [FAILURE]: true,
    code,
    status: ERROR_STATUS[code],
    details: options.details,
    retryAfter: retryAfterOf(code, options.retryAfter),
    headers: options.headers,
  });

export const isFailure = (err: unknown): err is Failure =>
  err instanceof Error && (err as Error & { [FAILURE]?: boolean })[FAILURE] === true;

export const errorEnvelope = (failure: Failure, agcid: string): ErrorEnvelope => {
  const error: ErrorBody = { code: failure.code, message: failure.message, agcid };
  if (failure.details && failure.details.length > 0) error.details = failure.details;
  return { success: false, error };
};

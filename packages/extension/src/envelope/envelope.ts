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

export type ErrorDetails = ErrorDetail[] | Record<string, unknown>;

export interface ErrorBody {
  code: string;
  message: string;
  agcid: string;
  details?: ErrorDetails;
}

export interface ErrorEnvelope {
  success: false;
  error: ErrorBody;
}

export interface Failure extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ErrorDetails;
  readonly retryAfter?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface FailOptions {
  // An array of field problems, or an object (a 412 carries { current, etag }).
  details?: ErrorDetails;
  // The wire code of a 4xx, UPPER_SNAKE (MACHINE_NOT_FOUND); the status stays the base code's.
  code?: string;
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
  // 204 sends no body; 200 when left out.
  status?: 200 | 201 | 204;
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

const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

const wireCode = (code: ErrorCode, override?: string): string => {
  if (override === undefined) return code;
  if (ERROR_STATUS[code] >= 500 || !UPPER_SNAKE.test(override))
    throw new Error(`fail code ${override}: UPPER_SNAKE on a 4xx only`);
  return override;
};

// Returned, not thrown, so a route reads `throw fail(...)`; the kit turns it into the envelope.
export const fail = (code: ErrorCode, message: string, options: FailOptions = {}): Failure =>
  Object.assign(new Error(message), {
    [FAILURE]: true,
    code: wireCode(code, options.code),
    status: ERROR_STATUS[code],
    details: options.details,
    retryAfter: retryAfterOf(code, options.retryAfter),
    headers: options.headers,
  });

export const isFailure = (err: unknown): err is Failure =>
  err instanceof Error && (err as Error & { [FAILURE]?: boolean })[FAILURE] === true;

export const errorEnvelope = (failure: Failure, agcid: string): ErrorEnvelope => {
  const error: ErrorBody = { code: failure.code, message: failure.message, agcid };
  const { details } = failure;
  const filled = Array.isArray(details)
    ? details.length > 0
    : details && Object.keys(details).length > 0;
  if (details && filled) error.details = details;
  return { success: false, error };
};

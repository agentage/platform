import { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';
import { agcidOfResponse } from '../agcid/scope.js';
import { errorEnvelope, fail, isFailure, type Failure } from '../envelope/envelope.js';
import { type Log } from '../log/log.js';

const bodyParserFailure = (err: unknown): Failure | null => {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') return fail('PAYLOAD_TOO_LARGE', 'Body too large');
  if (type === 'entity.parse.failed') return fail('VALIDATION_ERROR', 'Invalid JSON body');
  return null;
};

// Anything that is not a kit failure is an INTERNAL 500 with a generic message; the log has it whole.
const toFailure = (err: unknown): Failure => {
  if (isFailure(err)) return err;
  return bodyParserFailure(err) ?? fail('INTERNAL', 'Internal error');
};

export const notFound: RequestHandler = () => {
  throw fail('NOT_FOUND', 'Not found');
};

const GONE_CODES: unknown[] = ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNABORTED'];

// A client abort leaves the socket destroyed; the same code from an app-side stream does not.
const clientGone = (err: unknown, res: Response): boolean =>
  GONE_CODES.includes((err as { code?: unknown } | null)?.code) && res.socket?.destroyed !== false;

export const errorHandler =
  (log: Log): ErrorRequestHandler =>
  (err: unknown, _req, res, _next) => {
    // A gone client or a started answer cannot take an envelope: close it, never write twice.
    const gone = clientGone(err, res);
    if (gone || res.headersSent) {
      if (gone) log.warn('client closed early');
      else log.error(err);
      return void res.destroy();
    }
    const failure = toFailure(err);
    if (failure.status >= 500) log.error(err);
    if (failure.retryAfter !== undefined) res.setHeader('Retry-After', String(failure.retryAfter));
    for (const [name, value] of Object.entries(failure.headers ?? {})) res.setHeader(name, value);
    res.status(failure.status).json(errorEnvelope(failure, agcidOfResponse(res)));
  };

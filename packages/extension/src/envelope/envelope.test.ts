import { describe, expect, it } from 'vitest';
import apiError from '../test-support/fixtures/api-error.json' with { type: 'json' };
import noAgcid from '../test-support/fixtures/neg-api-error-no-agcid.json' with { type: 'json' };
import { ERROR_CODES, ERROR_STATUS } from './codes.js';
import { errorEnvelope, fail, isFailure, ok, type Failure } from './envelope.js';
import { ErrorEnvelopeSchema, OkEnvelopeSchema } from './envelope.schema.js';
import { parse } from './parse.js';
import { z } from 'zod';

const AGCID = '0193a1f2-7c4e-7b2a-9f10-3c5d8e2a4b61';

describe('envelope', () => {
  it('ok wraps data, with meta only when given', () => {
    expect(ok({ msg: 'hi' })).toEqual({ success: true, data: { msg: 'hi' } });
    expect(ok([], { pagination: { limit: 50 } })).toEqual({
      success: true,
      data: [],
      meta: { pagination: { limit: 50 } },
    });
    expect(OkEnvelopeSchema.safeParse(ok(1)).success).toBe(true);
  });

  it('keeps the closed code set and statuses of api-standards', () => {
    expect(ERROR_CODES).toEqual([
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'PRECONDITION_FAILED',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMITED',
      'INTERNAL',
      'UNAVAILABLE',
    ]);
    for (const code of ERROR_CODES) expect(fail(code, 'x').status).toBe(ERROR_STATUS[code]);
  });

  it('fail is a throwable failure; 429 and 503 carry Retry-After', () => {
    const failure = fail('NOT_FOUND', 'No such thing');
    expect(failure).toBeInstanceOf(Error);
    expect(isFailure(failure)).toBe(true);
    expect(isFailure(new Error('plain'))).toBe(false);
    expect(failure.retryAfter).toBeUndefined();
    expect(fail('UNAVAILABLE', 'down').retryAfter).toBe(30);
    expect(fail('RATE_LIMITED', 'slow', { retryAfter: 5 }).retryAfter).toBe(5);
  });

  it('errorEnvelope carries agcid and details only when present', () => {
    expect(errorEnvelope(fail('CONFLICT', 'Taken'), AGCID)).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'Taken', agcid: AGCID },
    });
    const details = [{ field: 'name', message: 'Required' }];
    const body = errorEnvelope(fail('VALIDATION_ERROR', 'Invalid body', { details }), AGCID);
    expect(body).toEqual(apiError);
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it('the schema takes the contract example and refuses one without agcid', () => {
    expect(ErrorEnvelopeSchema.safeParse(apiError).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse(noAgcid).success).toBe(false);
    const unknownCode = { ...apiError, error: { ...apiError.error, code: 'TEAPOT' } };
    expect(ErrorEnvelopeSchema.safeParse(unknownCode).success).toBe(false);
  });
});

describe('parse', () => {
  const Query = z.object({ msg: z.string().min(1), n: z.coerce.number().optional() });

  it('returns the parsed value', () => {
    expect(parse(Query, { msg: 'hi', n: '2' })).toEqual({ msg: 'hi', n: 2 });
  });

  const failureOf = (run: () => unknown): Failure => {
    try {
      run();
    } catch (err) {
      if (isFailure(err)) return err;
    }
    throw new Error('expected a kit failure');
  };

  it('throws VALIDATION_ERROR 400 with one detail per field', () => {
    const failure = failureOf(() => parse(Query, { n: 'x' }));
    expect(failure).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(failure.message).toBe('Invalid request');
    expect(failure.details?.map((d) => d.field)).toEqual(['msg', 'n']);
  });

  it('names the root when the value itself is wrong, and takes a message', () => {
    const failure = failureOf(() => parse(z.string(), 1, 'Invalid body'));
    expect(failure.message).toBe('Invalid body');
    expect(failure.details?.map((d) => d.field)).toEqual(['(root)']);
  });
});

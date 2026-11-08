import { z } from 'zod';
import { AGCID_PATTERN } from '../agcid/header.js';
import { ERROR_CODES } from './codes.js';

const AgcidSchema = z.string().regex(AGCID_PATTERN);

const ErrorCodeSchema = z.enum(ERROR_CODES as [string, ...string[]]);

export const ErrorEnvelopeSchema = z.strictObject({
  success: z.literal(false),
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    agcid: AgcidSchema,
    details: z.array(z.strictObject({ field: z.string(), message: z.string() })).optional(),
  }),
});

export const OkEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

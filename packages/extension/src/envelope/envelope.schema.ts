import { z } from 'zod';
import { ERROR_CODES } from './codes.js';

export const AgcidSchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

export const ErrorCodeSchema = z.enum(ERROR_CODES as [string, ...string[]]);

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

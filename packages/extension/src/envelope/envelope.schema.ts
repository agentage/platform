import { z } from 'zod';
import { AGCID_PATTERN } from '../agcid/header.js';

const AgcidSchema = z.string().regex(AGCID_PATTERN);

const ErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);

export const ErrorEnvelopeSchema = z.strictObject({
  success: z.literal(false),
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    agcid: AgcidSchema,
    details: z
      .union([
        z.array(z.strictObject({ field: z.string(), message: z.string() })),
        z.record(z.string(), z.unknown()),
      ])
      .optional(),
  }),
});

export const OkEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

import { z } from 'zod';

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;

const DurationSchema = z.union([
  z.int().positive(),
  z.string().regex(/^[0-9]+(ms|s|m|h)$/, { message: 'a duration like 500ms, 30s, 5m or 1h' }),
]);

export const JobNameSchema = z
  .string()
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/, { message: 'job names are lowercase, digits and dashes' });

export const JobOptionsSchema = z.strictObject({ timeout: DurationSchema.optional() }).optional();

export interface JobOptions {
  timeout?: number | string;
}

export const toMs = (duration: number | string): number => {
  if (typeof duration === 'number') return duration;
  const match = /^([0-9]+)(ms|s|m|h)$/.exec(duration);
  return Number(match?.[1]) * UNIT_MS[(match?.[2] ?? 'ms') as keyof typeof UNIT_MS];
};

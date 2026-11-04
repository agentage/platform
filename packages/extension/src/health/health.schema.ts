import { z } from 'zod';
import { ExtensionIdSchema, VersionSchema } from '../manifest/primitives.schema.js';

const HealthStatusSchema = z.enum(['ok', 'degraded', 'unavailable']);

const DeployedPartKindSchema = z.enum(['pages', 'ui', 'api', 'mcp', 'worker', 'store']);

// GET /health of every part container (api-standards section 7); never hostnames, IPs or env values.
export const HealthSchema = z.strictObject({
  success: z.boolean(),
  data: z.strictObject({
    status: HealthStatusSchema,
    extension: ExtensionIdSchema,
    part: DeployedPartKindSchema,
    version: VersionSchema,
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    buildTime: z.iso.datetime(),
    instance: z.string().regex(/^[0-9a-f]{8,32}$/),
    uptimeSeconds: z.int().min(0),
    checkedAt: z.iso.datetime(),
    checks: z.record(z.string().regex(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$/), HealthStatusSchema),
  }),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type HealthBody = z.infer<typeof HealthSchema>;

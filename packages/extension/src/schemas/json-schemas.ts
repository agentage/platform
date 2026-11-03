import { z } from 'zod';
import { DiscoveryDocumentSchema, ExtensionRecordSchema } from '../discovery/discovery.schema.js';
import { ErrorEnvelopeSchema, OkEnvelopeSchema } from '../envelope/envelope.schema.js';
import { HealthSchema } from '../health/health.schema.js';
import { PackageSchema } from '../manifest/manifest.schema.js';

const BASE = 'https://agentage.io/schemas/';

const SOURCES: Record<string, { schema: z.ZodType; title: string }> = {
  'extension-package.schema.json': {
    schema: PackageSchema,
    title: 'agentage extension package.json',
  },
  'extension-record.schema.json': {
    schema: ExtensionRecordSchema,
    title: 'agentage-extension.json build record (in the package and the release asset)',
  },
  'extension-discovery.schema.json': {
    schema: DiscoveryDocumentSchema,
    title: 'GET /.well-known/agentage-extension.json',
  },
  'health.schema.json': { schema: HealthSchema, title: 'GET /health of every part container' },
  'error-envelope.schema.json': { schema: ErrorEnvelopeSchema, title: 'REST error envelope' },
  'ok-envelope.schema.json': { schema: OkEnvelopeSchema, title: 'REST success envelope' },
};

// Generated from the Zod schemas, the source of truth; cross-field rules live in Zod only.
export const jsonSchemas = (): Record<string, Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(SOURCES).map(([file, { schema, title }]) => [
      file,
      { $id: `${BASE}${file}`, title, ...z.toJSONSchema(schema, { io: 'input' }) },
    ])
  );

export const schemaText = (schema: Record<string, unknown>): string =>
  `${JSON.stringify(schema, null, 2)}\n`;

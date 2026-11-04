import { join } from 'node:path';
import { z } from 'zod';
import { readJsonIfExists } from '../manifest/read-manifest.js';

export const OPENAPI_FILE = 'openapi.json';
export const OPENAPI_PATH = '/api/v1/openapi.json';

const OpenapiSchema = z.looseObject({
  openapi: z.string().regex(/^3\.1\.[0-9]+$/, { message: 'OpenAPI 3.1' }),
  paths: z.record(z.string(), z.unknown()),
});

// The api's contract, committed beside package.json (the repo diffs it against its Zod schemas).
export const readOpenapi = async (dir: string): Promise<Record<string, unknown> | null> => {
  const value = await readJsonIfExists(join(dir, OPENAPI_FILE));
  if (value === undefined) return null;
  const result = OpenapiSchema.safeParse(value);
  if (!result.success) throw new Error(`${OPENAPI_FILE} is not an OpenAPI 3.1 document`);
  return result.data;
};

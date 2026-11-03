import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonSchemas, schemaText } from './json-schemas.js';

const DIR = resolve(import.meta.dirname, '..', '..', 'schemas');

describe('JSON schemas', () => {
  it('the committed schemas/ equal what the Zod schemas generate (npm run schemas)', () => {
    for (const [file, schema] of Object.entries(jsonSchemas())) {
      expect(readFileSync(join(DIR, file), 'utf8'), file).toBe(schemaText(schema));
    }
  });

  it('are 2020-12 with an agentage.io $id', () => {
    for (const [file, schema] of Object.entries(jsonSchemas())) {
      expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema['$id']).toBe(`https://agentage.io/schemas/${file}`);
    }
  });
});

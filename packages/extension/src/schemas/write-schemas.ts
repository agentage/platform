import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonSchemas, schemaText } from './json-schemas.js';

const outDir = process.argv[2] ?? 'schemas';
await mkdir(outDir, { recursive: true });
for (const [file, schema] of Object.entries(jsonSchemas())) {
  await writeFile(join(outDir, file), schemaText(schema));
}

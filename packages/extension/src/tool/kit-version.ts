import { readFileSync } from 'node:fs';

// The kit's own version: what a kit-shaped manifest's engines.agentage ranges over.
export const KIT_VERSION = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

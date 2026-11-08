import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Empty on purpose: `declare module '@agentage/extension' { interface Secrets { githubRead: string } }` adds names.
export interface Secrets {}

export const SECRETS_DIR = '/run/secrets';

export const camelName = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

// Only a missing file reads as no value; any other error stops the part with its code.
const valueOf = (file: string, refused: string): Promise<string> =>
  readFile(file, 'utf8').then(
    (text) => text.replace(/\r?\n$/, ''),
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return '';
      throw new Error(`${refused} cannot be read: ${err.code ?? 'unknown'}`);
    }
  );

// Each declared name from its mounted file; a missing or empty file stops the part, named, never valued.
export const readSecrets = async (names: readonly string[], dir: string, part: string) => {
  const refused = (name: string) => `${part} refused to start: secret ${name}`;
  const read = names.map(
    async (name) => [name, await valueOf(join(dir, name), refused(name))] as const
  );
  const pairs = await Promise.all(read);
  const missing = pairs.find(([, value]) => value === '');
  if (missing) throw new Error(`${refused(missing[0])} has no value`);
  const secrets: Record<string, string> = Object.fromEntries(
    pairs.map(([name, value]) => [camelName(name), value])
  );
  return Object.freeze(secrets);
};

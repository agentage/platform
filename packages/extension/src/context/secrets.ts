import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Empty on purpose: `declare module '@agentage/extension' { interface Secrets { githubRead: string } }` adds names.
export interface Secrets {}

export const SECRETS_DIR = '/run/secrets';

export const camelName = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const valueOf = (file: string): Promise<string> =>
  readFile(file, 'utf8').then(
    (text) => text.replace(/\r?\n$/, ''),
    () => ''
  );

// Each declared name from its mounted file; a missing or empty file stops the part, named, never valued.
export const readSecrets = async (names: readonly string[], dir: string, part: string) => {
  const read = names.map(async (name) => [name, await valueOf(join(dir, name))] as const);
  const pairs = await Promise.all(read);
  const missing = pairs.find(([, value]) => value === '');
  if (missing) throw new Error(`${part} refused to start: secret ${missing[0]} has no value`);
  const secrets: Record<string, string> = Object.fromEntries(
    pairs.map(([name, value]) => [camelName(name), value])
  );
  return Object.freeze(secrets);
};

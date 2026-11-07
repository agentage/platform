import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { readJsonIfExists } from '../../manifest/read-manifest.js';
import { type Env } from '../../runtime/build-info.js';
import { LOCAL_DIR } from './local-record.js';

const FILE = `${LOCAL_DIR}/secrets.json`;

export const secretEnvName = (name: string): string =>
  `AGENTAGE_SECRET_${name.toUpperCase().replace(/-/g, '_')}`;

// A parse error quotes the text, so any error is replaced by one that names only the file.
const fileValues = (dir: string) =>
  readJsonIfExists(join(dir, FILE)).then(
    (value) => (value ?? {}) as Record<string, unknown>,
    (err: NodeJS.ErrnoException) => {
      const why = err.code ? 'cannot be read' : 'is not valid JSON';
      return Promise.reject(new Error(`up stopped: ${FILE} ${why}`));
    }
  );

const valueOf = (name: string, env: Env, file: Record<string, unknown>): string => {
  const value = env[secretEnvName(name)] || file[name];
  if (typeof value === 'string' && value !== '') return value;
  throw new Error(
    `up stopped: secret ${name} has no value: set ${secretEnvName(name)} or "${name}" in ${FILE}`
  );
};

// Each value as a file compose mounts at /run/secrets/<name>; the env wins over the file.
export const writeUpSecrets = async (dir: string, pkg: ExtensionPackage, env: Env) => {
  const names = pkg.agentage.secrets ?? [];
  if (names.length === 0) return undefined;
  const file = await fileValues(dir);
  const files = names.map((name) => ({
    name,
    path: join(dir, LOCAL_DIR, 'secrets', name),
    value: valueOf(name, env, file),
  }));
  await mkdir(join(dir, LOCAL_DIR, 'secrets'), { recursive: true, mode: 0o700 });
  // chmod after the write: an existing file from an older up gets 0600 too; down removes them.
  for (const { path, value } of files)
    await writeFile(path, value, { mode: 0o600 }).then(() => chmod(path, 0o600));
  return Object.fromEntries(files.map(({ name, path }) => [name, path]));
};

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ExtensionPackage } from './manifest.schema.js';
import { entryOf } from './parts.js';
import { type ImagePartKind } from './primitives.schema.js';

export type ImportModule = (file: string) => Promise<unknown>;

const importFile: ImportModule = (file) => import(pathToFileURL(file).href);

export const createOf = (mod: unknown, file: string): ((ctx: never) => unknown) => {
  const create = (mod as { create?: unknown } | null)?.create;
  if (typeof create !== 'function') throw new Error(`${file} does not export create(ctx)`);
  return create as (ctx: never) => unknown;
};

// The entry itself missing (not a module it imports) means the package was never built.
const notBuilt = (err: unknown, file: string): unknown => {
  const missing = (err as NodeJS.ErrnoException | null)?.code === 'ERR_MODULE_NOT_FOUND';
  const message = String((err as Error | null)?.message);
  const named = [file, pathToFileURL(file).href].some((name) => message.includes(`'${name}'`));
  if (!missing || !named) return err;
  return new Error(`${file} not found: build the package first (npm run build)`);
};

// The one way the kit reaches part code: import the part's entry, take its create(ctx).
export const loadCreate = async <C>(
  dir: string,
  pkg: ExtensionPackage,
  part: ImagePartKind | 'cli',
  importModule: ImportModule = importFile
): Promise<(ctx: C) => unknown> => {
  const file = join(dir, entryOf(pkg, part));
  const mod = await importModule(file).catch((err: unknown) => {
    throw notBuilt(err, file);
  });
  return createOf(mod, file) as (ctx: C) => unknown;
};

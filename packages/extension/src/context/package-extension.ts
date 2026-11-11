import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PackageSchema, type ExtensionPackage } from '../manifest/manifest.schema.js';
import { storeOf } from '../manifest/parts.js';
import { type ExtensionInfo } from './context.js';

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

// The id, version and store kind of the package a test runs in; nothing outside an extension.
export const packageManifest = (dir = process.cwd()): ExtensionPackage | undefined =>
  PackageSchema.safeParse(readJson(join(dir, 'package.json'))).data;

export const packageExtension = (dir = process.cwd()): Partial<ExtensionInfo> => {
  const pkg = packageManifest(dir);
  if (!pkg) return {};
  const { version, agentage } = pkg;
  const store = storeOf(pkg);
  return { id: agentage.id, version, ...(store && { store }) };
};

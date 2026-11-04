import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type z } from 'zod';
import { PackageSchema, type ExtensionPackage } from './manifest.schema.js';

export const formatIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => `${issue.path.map((segment) => String(segment)).join('.')}: ${issue.message}`)
    .join('; ');

export const validateManifest = (value: unknown): ExtensionPackage => {
  const result = PackageSchema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(
    `invalid agentage manifest in package.json: ${formatIssues(result.error.issues)}`
  );
};

const parseJson = (text: string, file: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
};

// undefined only for a missing file (JSON never parses to it); any other read error is thrown.
export const readJsonIfExists = async (file: string): Promise<unknown> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  return parseJson(text, file);
};

// The manifest is the `agentage` block of package.json, read as data without running code.
export const readManifest = async (dir: string): Promise<ExtensionPackage> => {
  const pkg = await readJsonIfExists(join(dir, 'package.json'));
  if (pkg === undefined) {
    throw new Error(`no package.json in ${dir}: run it in an extension package folder`);
  }
  return validateManifest(pkg);
};

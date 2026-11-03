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

// The manifest is the `agentage` block of package.json, read as data without running code.
export const readManifest = async (dir: string): Promise<ExtensionPackage> => {
  const file = join(dir, 'package.json');
  const text = await readFile(file, 'utf8');
  return validateManifest(JSON.parse(text) as unknown);
};

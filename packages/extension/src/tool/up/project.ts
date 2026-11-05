import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readJsonIfExists } from '../../manifest/read-manifest.js';

// One compose project per working copy: two checkouts of one extension never share containers or data.
export const projectName = (id: string, dir: string): string =>
  `agentage-${id}-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`;

// Kit 0.2.0 named one project per id, shared by every copy; down still removes it.
export const legacyProject = (id: string): string => `agentage-${id}`;

// Absolute, symlinks resolved, so one working copy always gets the same project name.
export const workingCopy = async (dir = '.'): Promise<string> => {
  const absolute = resolve(dir);
  return realpath(absolute).catch(() => absolute);
};

const RenderedSchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/) });

// The project a rendered compose file names; down trusts it only when it is this folder's own.
export const renderedProject = async (file: string): Promise<string | undefined> => {
  const parsed = RenderedSchema.safeParse(await readJsonIfExists(file).catch(() => undefined));
  return parsed.success ? parsed.data.name : undefined;
};

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod/mini';
import { ExtensionIdSchema } from '../register/names.js';

const VersionSchema = z
  .string()
  .check(
    z.regex(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/,
      'a semver'
    )
  );

const PackageSchema = z.object({
  version: VersionSchema,
  agentage: z.object({ id: ExtensionIdSchema }),
});

export interface UiManifest {
  id: string;
  version: string;
}

export const readUiManifest = async (dir: string): Promise<UiManifest> => {
  const file = join(dir, 'package.json');
  const text = await readFile(file, 'utf8').catch(() => {
    throw new Error(`no package.json in ${dir}`);
  });
  const parsed = PackageSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${file}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`);
  }
  return { id: parsed.data.agentage.id, version: parsed.data.version };
};

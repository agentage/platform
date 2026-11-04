import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE = fileURLToPath(new URL('./fixture', import.meta.url));

// A throwaway extension; index.ts must not import packages (it has no node_modules).
export const tempExtension = async (pkg: unknown, index?: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'agentage-widget-ext-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
  if (index !== undefined) {
    await mkdir(join(dir, 'src/ui'), { recursive: true });
    await writeFile(join(dir, 'src/ui/index.ts'), index);
  }
  return dir;
};

export const probePackage = { version: '0.2.0', agentage: { id: 'probe' } };

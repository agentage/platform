import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin } from 'esbuild';

const here = fileURLToPath(import.meta.url);
const ownSrc = join(dirname(here), '..');
const ext = extname(here);

const SUBPATHS: Record<string, string> = {
  '@agentage/widget': 'index',
  '@agentage/widget/ds': 'ds/index',
  '@agentage/widget/register': 'register/index',
};

export const ownFile = (path: string): string => {
  const file = join(ownSrc, `${path}${ext}`);
  if (existsSync(file)) return file;
  return join(ownSrc, `${path}.tsx`);
};

// One runtime per bundle: widget imports always resolve to this bundler's own copy.
export const selfResolve: Plugin = {
  name: 'agentage-widget-self',
  setup(build) {
    build.onResolve({ filter: /^@agentage\/widget(\/(ds|register))?$/ }, (args) => {
      const target = SUBPATHS[args.path];
      return target ? { path: ownFile(target) } : undefined;
    });
  },
};

import { join } from 'node:path';
import { build, type BuildOptions } from 'esbuild';
import { ownFile, selfResolve } from './self-resolve.js';

const common = (dir: string): BuildOptions => ({
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  logLevel: 'silent',
  absWorkingDir: dir,
  plugins: [selfResolve],
  define: { 'process.env.NODE_ENV': '"production"' },
});

const browser = (dir: string): BuildOptions => ({
  ...common(dir),
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
});

const entryCode = (id: string, version: string): string =>
  [
    "import { registerWidgets } from '@agentage/widget/register';",
    "import { widgets } from './src/ui/index.ts';",
    `registerWidgets(${JSON.stringify(id)}, widgets, { version: ${JSON.stringify(version)} });`,
  ].join('\n');

export const buildModule = async (dir: string, id: string, version: string, outfile: string) => {
  const stdin = { contents: entryCode(id, version), resolveDir: dir, loader: 'ts' as const };
  await build({ ...browser(dir), stdin, outfile });
};

export const buildHarness = async (dir: string, outfile: string) => {
  await build({ ...browser(dir), entryPoints: [ownFile('harness/main')], outfile });
};

// A node build of the widgets map, imported to read the names (never parsed from source).
export const buildMapForNode = async (dir: string, outfile: string) => {
  await build({
    ...common(dir),
    platform: 'node',
    entryPoints: [join(dir, 'src/ui/index.ts')],
    outfile,
  });
};

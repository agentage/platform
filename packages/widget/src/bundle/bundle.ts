import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildHarness, buildModule } from './build.js';
import { harnessPage } from './harness-page.js';
import { readUiManifest } from './manifest.js';
import { widgetRecords, type WidgetRecord } from './widget-names.js';

export interface BundleOptions {
  dir?: string;
}

export interface BundleResult {
  id: string;
  version: string;
  outDir: string;
  files: { module: string; widgets: string; harness: string; harnessScript: string };
  widgets: WidgetRecord[];
}

const requireEntry = async (dir: string): Promise<void> => {
  const entry = join(dir, 'src/ui/index.ts');
  if (!(await stat(entry).catch(() => undefined))) throw new Error(`no ui entry at ${entry}`);
};

export const bundle = async (options: BundleOptions = {}): Promise<BundleResult> => {
  const dir = resolve(options.dir ?? '.');
  const { id, version } = await readUiManifest(dir);
  await requireEntry(dir);
  const outDir = join(dir, 'dist/ui');
  const files = {
    module: join(outDir, `${id}.js`),
    widgets: join(outDir, 'widgets.json'),
    harness: join(outDir, 'harness.html'),
    harnessScript: join(outDir, 'harness.js'),
  };
  const widgets = await widgetRecords(dir, id, version);
  await mkdir(outDir, { recursive: true });
  await buildModule(dir, id, version, files.module);
  await buildHarness(dir, files.harnessScript);
  await writeFile(files.widgets, `${JSON.stringify(widgets, null, 2)}\n`);
  await writeFile(files.harness, await harnessPage(id, version));
  return { id, version, outDir, files, widgets };
};

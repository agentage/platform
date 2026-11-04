import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/mini';
import { elementName, widgetName } from '../register/names.js';
import { buildMapForNode } from './build.js';

export interface WidgetRecord {
  name: string;
  element: string;
  module: string;
}

const isComponent = (value: unknown): boolean =>
  typeof value === 'function' ||
  (typeof value === 'object' && value !== null && '$$typeof' in value);

const MapModuleSchema = z.object({
  widgets: z
    .record(
      z.string(),
      z.unknown().check(z.refine(isComponent, 'a widget is not a React component'))
    )
    .check(z.refine((map) => Object.keys(map).length > 0, 'the widgets map is empty')),
});

const importMap = async (dir: string): Promise<string[]> => {
  const tmp = await mkdtemp(join(tmpdir(), 'agentage-widget-'));
  try {
    const file = join(tmp, 'map.mjs');
    await buildMapForNode(dir, file);
    const parsed = MapModuleSchema.safeParse(await import(pathToFileURL(file).href));
    if (!parsed.success) throw new Error(`src/ui/index.ts: ${parsed.error.issues[0]?.message}`);
    return Object.keys(parsed.data.widgets);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};

export const widgetRecords = async (dir: string, id: string, version: string) =>
  (await importMap(dir)).map((key): WidgetRecord => ({
    name: widgetName(key),
    element: elementName(id, key),
    module: `/ui/${version}/${id}.js`,
  }));

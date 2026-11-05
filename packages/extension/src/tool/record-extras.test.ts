import { describe, expect, it } from 'vitest';
import { recordOf, validateRecord } from '../discovery/discovery.js';
import { validateManifest } from '../manifest/read-manifest.js';
import { linkModules } from '../test-support/http.js';
import { DIGEST, json, SHA, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { recordExtras, toolNames } from './record-extras.js';

const FULL = validateManifest(SPEC_MANIFEST);
const BUILD = { commit: SHA, buildTime: '2026-11-05T10:00:00Z' };
const WIDGETS = [{ name: 'echo', element: 'probe-echo', module: '/ui/0.1.0/probe.js' }];

const MCP = `import { z } from 'zod';
export const create = (ctx) => {
  const spec = { description: 'Echo', input: z.object({}), output: z.object({}) };
  ctx.tool('echo', spec, () => ({}));
  ctx.tool('count', spec, () => ctx.store.query('select 1'));
};
`;

const probe = async (files: Record<string, string> = {}) => {
  const dir = await tempPackage({
    'package.json': json(SPEC_MANIFEST),
    'dist/mcp/index.js': MCP,
    'dist/ui/widgets.json': json(WIDGETS),
    'migrations/001-ticks.sql': 'create table ticks (id int);',
    'migrations/002-more.sql': 'create table more (id int);',
    'openapi.json': json({ openapi: '3.1.0', info: { title: 'probe' }, paths: {} }),
    ...files,
  });
  await linkModules(dir);
  return dir;
};

const images = Object.fromEntries(
  ['pages', 'ui', 'api', 'mcp', 'worker'].map((part) => [
    part,
    `ghcr.io/agentage/probe-${part}@${DIGEST}`,
  ])
);

describe('recordExtras', () => {
  it('lists the tools the mcp part registers, the widgets, the openapi path and the migration count', async () => {
    const dir = await probe();
    const extras = await recordExtras(dir, FULL);
    expect(extras).toEqual({
      tools: ['probe__echo', 'probe__count'],
      widgets: WIDGETS,
      openapi: '/api/v1/openapi.json',
      migrations: 2,
    });
    const record = validateRecord(recordOf(FULL, BUILD, images, extras));
    expect(record).toMatchObject({
      tools: ['probe__echo', 'probe__count'],
      commands: ['ping'],
      widgets: WIDGETS,
      openapi: '/api/v1/openapi.json',
      parts: { store: { kind: 'postgres', migrations: 2 } },
    });
  });

  it('leaves out what the package does not have', async () => {
    const dir = await probe({ 'dist/mcp/index.js': 'export const create = () => undefined;' });
    const bare = validateManifest({
      ...SPEC_MANIFEST,
      agentage: { id: 'probe', parts: { mcp: true, ui: true } },
    });
    expect(await recordExtras(dir, bare)).toEqual({ widgets: WIDGETS });
    const noWidgets = await tempPackage({
      'dist/mcp/index.js': 'export const create = () => undefined;',
    });
    expect(await recordExtras(noWidgets, bare)).toEqual({ widgets: undefined });
  });

  it('refuses an mcp entry without create, a bad widgets.json and a bad openapi.json', async () => {
    await expect(
      toolNames(await probe({ 'dist/mcp/index.js': 'export const x = 1;' }), FULL)
    ).rejects.toThrow(/dist\/mcp\/index\.js does not export create\(ctx\)/);
    await expect(recordExtras(await probe({ 'dist/ui/widgets.json': '[]' }), FULL)).rejects.toThrow(
      'Too small: expected array to have >=1 items'
    );
    const extra = json([{ ...WIDGETS[0], size: 1 }]);
    await expect(
      recordExtras(await probe({ 'dist/ui/widgets.json': extra }), FULL)
    ).rejects.toThrow('Unrecognized key: \\"size\\"');
    const swagger = json({ swagger: '2.0', paths: {} });
    await expect(recordExtras(await probe({ 'openapi.json': swagger }), FULL)).rejects.toThrow(
      'openapi.json is not an OpenAPI 3.1 document'
    );
  });
});

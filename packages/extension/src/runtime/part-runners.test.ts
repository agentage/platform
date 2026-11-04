import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpSnapshot } from '../mcp/snapshot.js';
import { linkModules } from '../test-support/http.js';
import { json, tempPackage } from '../test-support/packages.js';
import { runPart } from './run-part.js';

const MANIFEST = {
  name: '@agentage/extension-probe',
  version: '0.2.0',
  engines: { agentage: '^0.2' },
  agentage: {
    id: 'probe',
    parts: { pages: true, ui: true, mcp: true, worker: true },
    settings: { 'mcp.listing': { type: 'string', enum: ['open', 'token'], default: 'open' } },
  },
};

const FILES = {
  'dist/mcp/index.js': `import { z } from 'zod';
export const create = (ctx) => {
  ctx.tool('echo', { description: 'Echo', input: z.object({ msg: z.string() }), output: z.object({ msg: z.string() }) },
    ({ msg }) => ({ msg: 'pong ' + msg }));
};
`,
  'dist/pages/index.js': `export const create = (ctx) => ({ '/': '<p>' + ctx.extension.id + ' ' + ctx.extension.part + '</p>' });\n`,
  'dist/ui/probe.js': 'export const widget = 1;\n',
  'dist/worker/index.js': `export const create = ({ schedule, log }) => { schedule('tick', '* * * * *', () => log.info('tick')); };\n`,
};

// SIGUSR2 stands in for SIGTERM: emitting it stops the server and the scheduler like a real stop.
const STOP = 'SIGUSR2' as const;

let dir: string;
let storeDir: string;
beforeAll(async () => {
  dir = await tempPackage({ 'package.json': json(MANIFEST), ...FILES });
  await linkModules(dir);
  const withStore = {
    ...MANIFEST,
    agentage: { ...MANIFEST.agentage, parts: { ...MANIFEST.agentage.parts, store: 'postgres' } },
  };
  storeDir = await tempPackage({ 'package.json': json(withStore), ...FILES });
});
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(() => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
});

const start = async (part: string, env: Record<string, string> = {}, at = dir): Promise<string> => {
  const server: Server = await runPart({
    dir: at,
    part,
    env: { PORT: '0', AGENTAGE_RECORD_FILE: `${at}/no-record.json`, ...env },
    serve: { signals: [STOP], exit: () => undefined },
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe('runPart per part', () => {
  it('mcp: imports dist/mcp/index.js and serves its tools as {id}__{name}', async () => {
    const url = await start('mcp');
    const snapshot = await mcpSnapshot(`${url}/mcp`, '2025-11-25');
    expect(snapshot.serverInfo).toEqual({ name: 'agentage-probe', version: '0.2.0' });
    expect(snapshot.tools.map((tool) => tool['name'])).toEqual(['probe__echo']);
  });

  it('mcp: the mcp.listing setting token closes tools/list', async () => {
    const url = await start('mcp', { AGENTAGE_SETTINGS: '{"mcp.listing":"token"}' });
    await expect(mcpSnapshot(`${url}/mcp`, '2026-07-28')).rejects.toThrow(/401/);
  });

  it('pages: serves the site its create(ctx) returns', async () => {
    const url = await start('pages');
    expect(await (await fetch(`${url}/`)).text()).toBe('<p>probe pages</p>');
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });

  it('ui: serves dist/ui under /ui/{version}/ and runs no code', async () => {
    const url = await start('ui');
    expect(await (await fetch(`${url}/ui/0.2.0/probe.js`)).text()).toBe(
      'export const widget = 1;\n'
    );
  });

  it('worker: schedules the jobs and reports them in /health, no discovery', async () => {
    const url = await start('worker');
    const health = (await (await fetch(`${url}/health`)).json()) as { data: { checks: object } };
    expect(health.data.checks).toEqual({ 'job:tick': 'ok' });
    expect((await fetch(`${url}/.well-known/agentage-extension.json`)).status).toBe(404);
  });

  it('worker with a postgres store: the store check joins the job checks', async () => {
    const url = await start(
      'worker',
      { AGENTAGE_STORE_URL: 'postgres://u:p@127.0.0.1:1/db' },
      storeDir
    );
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(503);
    const health = (await res.json()) as { data: { checks: object } };
    expect(health.data.checks).toEqual({ store: 'unavailable', 'job:tick': 'ok' });
  });

  it('refuses a part the manifest does not have and the cli part', async () => {
    await expect(start('api')).rejects.toThrow('part api is not an image part of this manifest');
    await expect(start('cli')).rejects.toThrow(/not an image part/);
  });
});

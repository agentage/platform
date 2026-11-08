import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeContracts } from '../tool/contracts.js';
import { linkModules } from '../test-support/http.js';
import { startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { json, tempPackage } from '../test-support/packages.js';
import { authEnv, startPart, STOP } from '../test-support/part-fixture.js';

const MANIFEST = {
  name: '@agentage/extension-probe',
  version: '0.6.0',
  engines: { agentage: '^0.6' },
  agentage: { id: 'probe', parts: { api: true } },
};
const API = `import { z } from 'zod';
export const create = ({ route }) => {
  route('get', '/echo', { summary: 'Echo', input: z.object({ msg: z.string() }) },
    ({ input, caller }) => ({ msg: input.msg, caller: caller.sub }));
  route('get', '/ping', { summary: 'Ping', scope: 'public' }, () => 'pong');
  route('post', '/items', { summary: 'Add', scope: 'write' }, () => 'added');
};
`;

// A committed file that fell behind the code: it calls the write route public.
const staleScope = async (file: string) => {
  const doc = JSON.parse(await readFile(file, 'utf8')) as {
    paths: Record<string, Record<string, { security: unknown }>>;
  };
  doc.paths['/api/v1/items']!['post']!.security = [];
  await writeFile(file, JSON.stringify(doc));
};

let url: string;
let issuer: TestIssuer;
beforeAll(async () => {
  const dir = await tempPackage({ 'package.json': json(MANIFEST), 'dist/api/index.js': API });
  await linkModules(dir);
  await writeContracts(dir);
  await staleScope(join(dir, 'openapi.json'));
  issuer = await startIssuer();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  url = await startPart(dir, 'api', authEnv(issuer, dir));
});
afterAll(async () => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
  await issuer.close();
});

describe('a ctx.route api part behind the token check', () => {
  it('guards a route at its declared scope, not at a stale committed one', async () => {
    const add = `${url}/api/v1/items`;
    expect((await fetch(add, { method: 'POST' })).status).toBe(401);
    const write = await issuer.bearer({ scope: 'probe:write' });
    const ok = await fetch(add, { method: 'POST', headers: { authorization: write } });
    expect(await ok.json()).toEqual({ success: true, data: 'added' });
  });

  it('serves a public route anonymously and asks a scoped one for its bearer', async () => {
    expect(await (await fetch(`${url}/api/v1/ping`)).json()).toEqual({
      success: true,
      data: 'pong',
    });
    expect((await fetch(`${url}/api/v1/echo?msg=hi`)).status).toBe(401);
    const read = await issuer.bearer({ scope: 'probe:read', sub: 'usr_1' });
    const echo = await fetch(`${url}/api/v1/echo?msg=hi`, { headers: { authorization: read } });
    expect(await echo.json()).toEqual({ success: true, data: { msg: 'hi', caller: 'usr_1' } });
    const add = await fetch(`${url}/api/v1/items`, {
      method: 'POST',
      headers: { authorization: read },
    });
    expect(add.status).toBe(403);
  });

  it('serves the contract generated from the routes and answers NOT_FOUND with an agcid off the routes', async () => {
    const doc = (await (await fetch(`${url}/api/v1/openapi.json`)).json()) as {
      paths: Record<string, Record<string, { security: unknown }>>;
    };
    expect(Object.keys(doc.paths)).toEqual(['/api/v1/echo', '/api/v1/ping', '/api/v1/items']);
    expect(doc.paths['/api/v1/items']?.['post']?.security).toEqual([{ pat: ['probe:write'] }]);
    // An undeclared path needs read, as before: the bearer first, then NOT_FOUND.
    const authorization = await issuer.bearer({ scope: 'probe:read' });
    const off = await fetch(`${url}/api/v1/nope`, {
      headers: { agcid: 'route-part-404', authorization },
    });
    expect([off.status, await off.json()]).toEqual([
      404,
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found', agcid: 'route-part-404' },
      },
    ]);
  });
});

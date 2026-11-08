import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeDir } from '../test-support/up-fixtures.js';
import { check } from './check.js';
import { writeContracts } from './contracts.js';
import { surface } from './rules/surface.js';

const ROUTES = (summary: string, tail = '') => `import { z } from 'zod';
export const create = ({ route }) => {
  route('get', '/echo', { summary: '${summary}', input: z.object({ msg: z.string() }) }, ({ input }) => input);
  ${tail}
};
`;

const withApi = async (code: string) => {
  const dir = await probeDir();
  await writeFile(join(dir, 'dist', 'api', 'index.js'), code);
  return dir;
};

const problems = async (dir: string) =>
  (await check(dir, { rules: [surface] })).problems.map((p) => p.problem);

describe('a ctx.route api part: openapi.json is generated', () => {
  it('writes the whole document, then surface passes and a second write changes nothing', async () => {
    const dir = await withApi(ROUTES('Echo'));
    expect(await problems(dir)).toEqual([expect.stringContaining('GET /api/v1/echo')]);
    expect(await writeContracts(dir)).toEqual(['openapi.json']);
    const text = await readFile(join(dir, 'openapi.json'), 'utf8');
    expect(text).toMatch(/^\{\n {2}"openapi": "3\.1\.0",\n {2}"info"/);
    expect(await problems(dir)).toEqual([]);
    expect(await writeContracts(dir)).toEqual([]);
  });

  // A fresh package per code change: Node caches the module it imported once.
  it('names the operation that drifted from the code', async () => {
    const first = await withApi(ROUTES('Echo'));
    await writeContracts(first);
    const dir = await withApi(ROUTES('Echo it'));
    await writeFile(join(dir, 'openapi.json'), await readFile(join(first, 'openapi.json')));
    expect(await problems(dir)).toEqual(['differs from the generated contract (GET /api/v1/echo)']);
  });

  it('is missing until written, and refuses routes beside a returned router', async () => {
    const dir = await withApi(ROUTES('Echo'));
    await rm(join(dir, 'openapi.json'));
    expect(await problems(dir)).toEqual([
      'is missing: check --write generates it from the ctx.route routes',
    ]);
    const both = await withApi(ROUTES('Echo', 'return () => {};'));
    expect(await problems(both)).toEqual([
      'the api part registers ctx.route routes and returns a router: pick one',
    ]);
  });
});

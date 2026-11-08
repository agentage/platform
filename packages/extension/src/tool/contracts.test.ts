import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type * as Snapshot from '../mcp/snapshot.js';
import { json } from '../test-support/packages.js';
import { PROBE, probeDir } from '../test-support/up-fixtures.js';
import { check } from './check.js';
import { writeContracts } from './contracts.js';
import { surface } from './rules/surface.js';

// A committed contract holding the key __throw makes canonical() throw, as a kit bug would.
vi.mock('../mcp/snapshot.js', async (original) => {
  const real = await original<typeof Snapshot>();
  const canonical = (value: unknown) => {
    if (typeof value === 'object' && value !== null && '__throw' in value)
      throw new Error('kit bug');
    return real.canonical(value);
  };
  return { ...real, canonical };
});

const surfaceOk = async (dir: string) => (await check(dir, { rules: [surface] })).problems;

describe('writeContracts', () => {
  it('changes nothing when the contracts already match the code', async () => {
    const dir = await probeDir();
    expect(await writeContracts(dir)).toEqual([]);
  });

  it('writes a missing tool list and the package version into openapi, in place', async () => {
    const dir = await probeDir({ ...PROBE, version: '0.3.0' });
    await rm(join(dir, 'probe.mcpc.json'));
    const openapi =
      '{\n  "openapi": "3.1.0",\n  "info": { "title": "probe", "version": "0.1.0" },\n  "paths": {}\n}\n';
    await writeFile(join(dir, 'openapi.json'), openapi);
    expect(await writeContracts(dir)).toEqual(['probe.mcpc.json', 'openapi.json']);
    expect(await readFile(join(dir, 'openapi.json'), 'utf8')).toBe(
      openapi.replace('0.1.0', '0.3.0')
    );
    expect(await surfaceOk(dir)).toEqual([]);
    expect(await writeContracts(dir)).toEqual([]);
  });

  it('leaves an openapi whose info.version sits behind a nested object to check', async () => {
    const dir = await probeDir();
    const info = { title: 'probe', contact: { name: 'x' }, version: '0.0.1' };
    await writeFile(join(dir, 'openapi.json'), json({ openapi: '3.1.0', info, paths: {} }));
    expect(await writeContracts(dir)).toEqual([]);
    expect(await surfaceOk(dir)).toHaveLength(1);
  });

  it('rewrites a contract left half-written by an earlier run', async () => {
    const dir = await probeDir();
    await writeFile(join(dir, 'probe.mcpc.json'), '{ "name": "agentage-pro');
    expect(await writeContracts(dir)).toEqual(['probe.mcpc.json']);
    expect(await surfaceOk(dir)).toEqual([]);
  });

  it('surfaces a canonical() failure, only a parse failure means rewrite', async () => {
    const dir = await probeDir();
    await writeFile(join(dir, 'probe.mcpc.json'), '{ "__throw": 1 }');
    await expect(writeContracts(dir)).rejects.toThrow('kit bug');
  });

  it('refuses an unbuilt package as check does', async () => {
    const dir = await probeDir();
    await rm(join(dir, 'dist'), { recursive: true });
    await expect(writeContracts(dir)).rejects.toThrow(
      'dist is missing: build the package first (npm run build)'
    );
  });

  it('leaves a package without api or mcp alone', async () => {
    const dir = await probeDir({ ...PROBE, agentage: { id: 'probe', parts: { pages: true } } });
    await rm(join(dir, 'probe.mcpc.json'));
    expect(await writeContracts(dir)).toEqual([]);
  });
});

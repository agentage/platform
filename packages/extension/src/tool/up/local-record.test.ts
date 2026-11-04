import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRecord } from '../../discovery/discovery.js';
import { API_MANIFEST, json, SHA, tempPackage } from '../../test-support/packages.js';
import { type BuildResult } from '../build.js';
import { type Run } from '../exec.js';
import { assertDiscoverable, LOCAL_DIR, writeLocalRecord } from './local-record.js';

const ID = `sha256:${'d'.repeat(64)}`;

const BUILT: BuildResult = {
  id: 'probe',
  version: '0.1.0',
  commit: SHA,
  buildTime: '2026-11-05T10:00:00Z',
  images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0' }],
};

describe('local record', () => {
  it('takes each image id from the local daemon in place of a registry digest', async () => {
    const dir = await tempPackage({ 'package.json': json(API_MANIFEST) });
    const calls: string[][] = [];
    const run: Run = async (_command, args) => (calls.push(args), { code: 0, stdout: `${ID}\n` });
    const { file, record } = await writeLocalRecord(dir, API_MANIFEST, BUILT, run);
    expect(file).toBe(join(dir, LOCAL_DIR, 'record.json'));
    expect(calls).toEqual([
      ['image', 'inspect', '-f', '{{.Id}}', 'ghcr.io/agentage/probe-api:0.1.0'],
    ]);
    expect(record.parts).toEqual({ api: { image: `ghcr.io/agentage/probe-api@${ID}` } });
    expect(validateRecord(JSON.parse(await readFile(file, 'utf8')))).toEqual(record);
    expect(() => assertDiscoverable(record, 'http://localhost:4280')).not.toThrow();
    expect(() => assertDiscoverable(record, 'http://example.com')).toThrow(
      /^discovery would be invalid: host: /
    );
  });

  it('fails when the daemon does not know the image', async () => {
    const dir = await tempPackage({ 'package.json': json(API_MANIFEST) });
    const run: Run = async () => ({ code: 1, stdout: '', stderr: 'No such image' });
    await expect(writeLocalRecord(dir, API_MANIFEST, BUILT, run)).rejects.toThrow(/No such image/);
  });
});

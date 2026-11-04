import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRecord } from '../../discovery/discovery.js';
import { API_MANIFEST } from '../../test-support/packages.js';
import { ENV, fakeDocker, IMAGE_ID, probeDir } from '../../test-support/up-fixtures.js';
import { routesOf, up } from './up.js';

describe('up files', () => {
  it('writes the local record, the gateway config and the compose file under .agentage/', async () => {
    const dir = await probeDir();
    await up({ dir, env: ENV }, { run: fakeDocker().run });
    const read = async (file: string) =>
      JSON.parse(await readFile(join(dir, '.agentage', file), 'utf8')) as Record<string, unknown>;
    const record = validateRecord(await read('record.json'));
    expect(record.parts.api).toEqual({ image: `ghcr.io/agentage/probe-api@${IMAGE_ID}` });
    expect(record).toMatchObject({
      tools: ['probe__echo'],
      commands: ['ping'],
      parts: { store: { migrations: 1 } },
    });
    expect(Object.keys((await read('gateway.yml'))['http'] as object)).toEqual([
      'middlewares',
      'services',
      'routers',
    ]);
    const compose = await read('compose.json');
    expect(compose['name']).toBe('agentage-probe');
    expect((compose['services'] as Record<string, { image?: string }>)['api']?.image).toBe(
      'ghcr.io/agentage/probe-api:0.2.0'
    );
  });
});

describe('routesOf', () => {
  it('lists the routes of the parts in gateway order', () => {
    expect(routesOf(API_MANIFEST)).toEqual(['/api/v1/']);
  });
});

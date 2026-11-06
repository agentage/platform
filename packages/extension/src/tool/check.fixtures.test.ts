import { cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkModules } from '../test-support/http.js';
import { tempPackage } from '../test-support/packages.js';
import { check, RULES } from './check.js';
import { checkLines, problemLines } from './format.js';

const FIXTURES = resolve(import.meta.dirname, '../../fixtures');

// npm run check:fixtures prints these titles: each is the one problem line its fixture gets.
const REFUSED: Record<string, string> = {
  manifest: 'manifest: agentage.id: lowercase id, never a name the platform owns',
  entries: 'entries: part api does not export create',
  surface: 'surface: openapi.json differs from the generated contract (GET /api/v1/echo)',
  stack: 'stack: express ^4.19.0, needs ^5',
  store:
    'store: migrations/002-broken.sql:1 fails on postgres:18-alpine: ERROR:  relation "missing" does not exist',
  sealing: 'sealing: src/api/index.ts:7 reads process.env',
};

// A copy of base, the overlay, the repo's modules, and the base's build, which is a copy.
const fixture = async (name: string): Promise<string> => {
  const dir = await tempPackage({});
  await cp(join(FIXTURES, 'base'), dir, { recursive: true });
  if (name !== 'base') await cp(join(FIXTURES, name), dir, { recursive: true });
  await linkModules(dir);
  await cp(join(dir, 'src/api/index.ts'), join(dir, 'dist/api/index.js'));
  return dir;
};

describe('6 of 6 refused, each for its own rule (bad-store needs docker)', () => {
  it('PASS base 0.1.0 conforms (6 rules)', async () => {
    expect(checkLines(await check(await fixture('base')))).toEqual([
      'manifest ok · entries ok · surface ok · stack ok · store ok · sealing ok',
      'PASS base 0.1.0 conforms (6 rules)',
    ]);
  });

  for (const rule of RULES.map(({ name }) => name)) {
    it(`REFUSED bad-${rule.padEnd(9)} ${REFUSED[rule]}`, async () => {
      expect(problemLines(await check(await fixture(`bad-${rule}`)))).toEqual([REFUSED[rule]]);
    });
  }
});

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WIDGET_VERSION } from './version.js';

it('reports the package version as the bridge client version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(WIDGET_VERSION).toBe(pkg.version);
});

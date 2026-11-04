import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { KIT_VERSION } from './kit-version.js';

describe('KIT_VERSION', () => {
  it('is the version of the kit package itself', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    ) as {
      name: string;
      version: string;
    };
    expect(pkg.name).toBe('@agentage/extension');
    expect(KIT_VERSION).toBe(pkg.version);
  });
});

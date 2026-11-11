import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { API_MANIFEST, tempPackage } from '../test-support/packages.js';
import { type PartContext } from './context.js';
import { camelName } from '../manifest/primitives.schema.js';
import { readSecrets } from './secrets.js';

type Declared = NonNullable<ExtensionPackage['agentage']['secrets']>;
const declaring = (...secrets: Declared): ExtensionPackage => ({
  ...API_MANIFEST,
  agentage: { ...API_MANIFEST.agentage, secrets },
});

describe('secrets', () => {
  it('maps a kebab name to the camelCase key ctx.secrets reads', () => {
    expect(['github-read', 'a', 'pat-2-key'].map(camelName)).toEqual([
      'githubRead',
      'a',
      'pat2Key',
    ]);
  });

  it('reads each declared file, the trailing newline dropped', async () => {
    const dir = await tempPackage({ 'github-read': 'ghp_x\n', 'smtp-pass': 'p w' });
    const secrets = await readSecrets(declaring('github-read', 'smtp-pass'), 'api', dir);
    expect(secrets).toEqual({ githubRead: 'ghp_x', smtpPass: 'p w' });
    expect(Object.isFrozen(secrets)).toBe(true);
    expect(await readSecrets(declaring(), 'api', join(dir, 'none'))).toEqual({});
  });

  it('refuses a missing or empty file by name, never by value', async () => {
    const dir = await tempPackage({ 'smtp-pass': 'hunter2' });
    await expect(readSecrets(declaring('smtp-pass', 'github-read'), 'mcp', dir)).rejects.toThrow(
      /^mcp refused to start: secret github-read has no value$/
    );
    await expect(readSecrets(declaring('constructor'), 'api', dir)).rejects.toThrow(
      'api refused to start: secret constructor has no value'
    );
    await writeFile(join(dir, 'github-read'), '\n');
    await expect(readSecrets(declaring('github-read'), 'api', dir)).rejects.toThrow(
      'api refused to start: secret github-read has no value'
    );
  });

  it('leaves a secret of another part out, and a read of it throws by name', async () => {
    const dir = await tempPackage({ 'github-read': 'ghp_x' });
    const secrets = (await readSecrets(
      declaring('github-read', { name: 'app-key', parts: ['worker'] }),
      'api',
      dir
    )) as Record<string, string>;
    expect({ ...secrets }).toEqual({ githubRead: 'ghp_x' });
    expect(Object.keys(secrets)).toEqual(['githubRead']);
    expect(() => secrets['appKey']).toThrow('secret app-key is not mounted in api');
  });

  it('names a secret file it cannot read, not as an empty value', async () => {
    const dir = await tempPackage({});
    await mkdir(join(dir, 'github-read'));
    await expect(readSecrets(declaring('github-read'), 'api', dir)).rejects.toThrow(
      /^api refused to start: secret github-read cannot be read: EISDIR/
    );
  });

  it('names no secret until an extension declares it with declare module', () => {
    const read = (ctx: PartContext) =>
      // @ts-expect-error a name nobody declared is a compile error, not undefined at runtime
      ctx.secrets.githubRaed;
    expect(read).toBeTypeOf('function');
  });
});

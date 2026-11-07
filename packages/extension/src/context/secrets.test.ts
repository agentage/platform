import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempPackage } from '../test-support/packages.js';
import { type PartContext } from './context.js';
import { camelName, readSecrets } from './secrets.js';

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
    const secrets = await readSecrets(['github-read', 'smtp-pass'], dir, 'api');
    expect(secrets).toEqual({ githubRead: 'ghp_x', smtpPass: 'p w' });
    expect(Object.isFrozen(secrets)).toBe(true);
    expect(await readSecrets([], join(dir, 'none'), 'api')).toEqual({});
  });

  it('refuses a missing or empty file by name, never by value', async () => {
    const dir = await tempPackage({ 'smtp-pass': 'hunter2' });
    await expect(readSecrets(['smtp-pass', 'github-read'], dir, 'mcp')).rejects.toThrow(
      /^mcp refused to start: secret github-read has no value$/
    );
    await writeFile(join(dir, 'github-read'), '\n');
    await expect(readSecrets(['github-read'], dir, 'api')).rejects.toThrow(
      'api refused to start: secret github-read has no value'
    );
  });

  it('names no secret until an extension declares it with declare module', () => {
    const read = (ctx: PartContext) =>
      // @ts-expect-error a name nobody declared is a compile error, not undefined at runtime
      ctx.secrets.githubRaed;
    expect(read).toBeTypeOf('function');
  });
});

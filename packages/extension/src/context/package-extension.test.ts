import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { packageExtension } from './package-extension.js';
import { createTestContext } from './test-context.js';

const inPackage = async (manifest: object) => {
  const dir = await tempPackage({ 'package.json': json(manifest) });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  return dir;
};

const { id } = SPEC_MANIFEST.agentage;
afterEach(() => void vi.restoreAllMocks());

describe('createTestContext reads ./package.json', () => {
  it('takes id, version and the postgres store with no options', async () => {
    await inPackage(SPEC_MANIFEST);
    const ctx = createTestContext();
    expect(ctx.extension).toMatchObject({ id, version: SPEC_MANIFEST.version, store: 'postgres' });
    expect(ctx.auth.caller({})?.scopes).toEqual([`${id}:read`]);
    expect(createTestContext({ args: {} }).extension).toMatchObject({ id, part: 'cli' });
  });

  it('opens a test store for the manifest store, and store false keeps it closed', async () => {
    await inPackage(SPEC_MANIFEST);
    const ctx = createTestContext();
    expect(await ctx.store.query<{ n: number }>('select 1 as n')).toEqual({ rows: [{ n: 1 }] });
    await ctx.close();
    const none = createTestContext({ store: false });
    expect(none.extension.store).toBeUndefined();
    await expect(none.store.query('select 1')).rejects.toThrow('declares no store');
  });

  it('keeps the explicit options ahead of the manifest', async () => {
    await inPackage(SPEC_MANIFEST);
    const ctx = createTestContext({ store: false, extension: { id: 'other', version: '9.0.0' } });
    expect(ctx.extension).toMatchObject({ id: 'other', version: '9.0.0' });
  });

  it('keeps a store kind the test store does not serve, and falls back outside an extension', async () => {
    const git = {
      ...SPEC_MANIFEST,
      agentage: {
        ...SPEC_MANIFEST.agentage,
        parts: { ...SPEC_MANIFEST.agentage.parts, store: 'git' },
      },
    };
    expect(packageExtension(await inPackage(git))).toMatchObject({ store: 'git' });
    expect(createTestContext().extension.store).toBe('git');
    expect(packageExtension(await inPackage({ name: 'not-an-extension' }))).toEqual({});
    expect(packageExtension('/nowhere')).toEqual({});
    expect(createTestContext().extension.id).toBe('test');
  });
});

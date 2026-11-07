import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../manifest/read-manifest.js';
import { API_MANIFEST, json, tempPackage } from '../../test-support/packages.js';
import { ENV, fakeDocker, PROBE, probeDir } from '../../test-support/up-fixtures.js';
import { secretEnvName, writeUpSecrets } from './secrets.js';
import { up } from './up.js';

const PKG = validateManifest({
  ...API_MANIFEST,
  agentage: { ...API_MANIFEST.agentage, secrets: ['github-read', 'smtp-pass'] },
});

describe('up secrets', () => {
  it('names the env variable after the secret', () => {
    expect(secretEnvName('github-read')).toBe('AGENTAGE_SECRET_GITHUB_READ');
  });

  it('writes each value to a 0644 file in a 0700 folder, the env over secrets.json', async () => {
    const files = { '.agentage/secrets.json': json({ 'github-read': 'file', 'smtp-pass': 'pw' }) };
    const dir = await tempPackage(files);
    const out = await writeUpSecrets(dir, PKG, { AGENTAGE_SECRET_GITHUB_READ: 'env' });
    const folder = join(dir, '.agentage/secrets');
    expect(out).toEqual({
      'github-read': `${folder}/github-read`,
      'smtp-pass': `${folder}/smtp-pass`,
    });
    expect(await readFile(`${folder}/github-read`, 'utf8')).toBe('env');
    expect(await readFile(`${folder}/smtp-pass`, 'utf8')).toBe('pw');
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect((await stat(`${folder}/smtp-pass`)).mode & 0o777).toBe(0o644);
  });

  it('refuses a missing value by name and a broken secrets.json without quoting it', async () => {
    const dir = await tempPackage({ '.agentage/secrets.json': json({ 'smtp-pass': 'pw' }) });
    await expect(writeUpSecrets(dir, PKG, {})).rejects.toThrow(
      'up stopped: secret github-read has no value: set AGENTAGE_SECRET_GITHUB_READ or "github-read" in .agentage/secrets.json'
    );
    await writeFile(join(dir, '.agentage/secrets.json'), '{"smtp-pass": hunter2}');
    const broken = writeUpSecrets(dir, PKG, {});
    await expect(broken).rejects.toThrow(
      /^up stopped: \.agentage\/secrets\.json is not valid JSON$/
    );
    expect(await writeUpSecrets(dir, validateManifest(API_MANIFEST), {})).toBeUndefined();
  });

  it('stops up before any docker call when a declared secret has no value', async () => {
    const dir = await probeDir({
      ...PROBE,
      agentage: { ...PROBE.agentage, secrets: ['github-read'] },
    });
    const docker = fakeDocker();
    await expect(up({ dir, env: ENV }, { run: docker.run })).rejects.toThrow(
      'up stopped: secret github-read has no value'
    );
    expect(docker.calls).toEqual([]);
  });
});

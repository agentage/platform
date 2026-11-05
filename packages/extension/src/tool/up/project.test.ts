import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempPackage } from '../../test-support/packages.js';
import { projectName, renderedProject, workingCopy } from './project.js';

describe('the compose project', () => {
  it('is one name per working copy: the id and a short hash of the folder', () => {
    // Fixed across kit versions: down after an upgrade must still find the containers.
    expect(projectName('probe', '/a/extension-probe')).toBe('agentage-probe-cc5e72d7');
    expect(projectName('probe', '/b/extension-probe')).not.toBe(
      projectName('probe', '/a/extension-probe')
    );
  });

  it('resolves a symlinked folder to its real path, and keeps a missing one as given', async () => {
    const dir = await tempPackage({ 'package.json': '{}' });
    const link = `${dir}-link`;
    await symlink(dir, link, 'dir');
    expect(await workingCopy(link)).toBe(await workingCopy(dir));
    expect(await workingCopy('/no/such/folder')).toBe('/no/such/folder');
  });

  it('reads the name the rendered compose file carries, nothing from a broken one', async () => {
    const dir = await tempPackage({ 'package.json': '{}' });
    await mkdir(join(dir, '.agentage'));
    const file = join(dir, '.agentage', 'compose.json');
    expect(await renderedProject(file)).toBeUndefined();
    await writeFile(file, '{"name":"agentage-probe"}');
    expect(await renderedProject(file)).toBe('agentage-probe');
    await writeFile(file, '{nope');
    expect(await renderedProject(file)).toBeUndefined();
    await writeFile(file, '{"name":"Bad Name"}');
    expect(await renderedProject(file)).toBeUndefined();
  });
});

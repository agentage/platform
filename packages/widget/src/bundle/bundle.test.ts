import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, probePackage, tempExtension } from '../test-support/extensions.js';
import { bundle, type BundleResult } from './bundle.js';

let result: BundleResult;
const temps: string[] = [];

const temp = async (pkg: unknown, index?: string) => {
  const dir = await tempExtension(pkg, index);
  temps.push(dir);
  return dir;
};

beforeAll(async () => {
  await rm(join(FIXTURE, 'dist'), { recursive: true, force: true });
  result = await bundle({ dir: FIXTURE });
}, 60_000);

afterAll(() => Promise.all(temps.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('bundle on the fixture extension', () => {
  it('writes widgets.json in the record shape, names read from the map', async () => {
    const widgets = JSON.parse(await readFile(join(FIXTURE, 'dist/ui/widgets.json'), 'utf8'));
    expect(widgets).toEqual([
      { name: 'echo', element: 'probe-echo', module: '/ui/0.2.0/probe.js' },
    ]);
    expect(result).toMatchObject({ id: 'probe', version: '0.2.0', widgets });
  });

  it('writes one minified self-contained module that registers on load', async () => {
    const code = await readFile(result.files.module, 'utf8');
    expect(result.files.module).toBe(join(FIXTURE, 'dist/ui/probe.js'));
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toContain('process.env');
    expect(code).toContain('"probe",');
    expect(code).toContain('customElements');
    expect(code).toContain('--tw-border-style');
    expect(code.split('\n').length).toBeLessThan(200);
  });

  it('writes harness.html for the id and version with its logic in harness.js', async () => {
    const html = await readFile(result.files.harness, 'utf8');
    expect(html).toContain('<meta name="agentage-extension" content="probe" />');
    expect(html).toContain('<meta name="agentage-version" content="0.2.0" />');
    expect(html).toContain('<script type="module" src="./harness.js"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toContain('{{');
    const script = await readFile(result.files.harnessScript, 'utf8');
    expect(script).toContain('http://localhost:4281/token');
  });
});

describe('bundle refuses', () => {
  it('a folder without package.json or a manifest without agentage.id', async () => {
    await expect(bundle({ dir: join(FIXTURE, 'src') })).rejects.toThrow(/no package.json/);
    const dir = await temp({ version: '0.1.0', agentage: { id: 'Bad' } });
    await expect(bundle({ dir })).rejects.toThrow(/agentage\.id an extension id is lowercase/);
    const noVersion = await temp({ version: 'one', agentage: { id: 'probe' } });
    await expect(bundle({ dir: noVersion })).rejects.toThrow(/version a semver/);
  });

  it('an extension without src/ui/index.ts', async () => {
    const dir = await temp(probePackage);
    await expect(bundle({ dir })).rejects.toThrow(/no ui entry/);
  });

  it('an empty map, a map that is not components, a bad name', async () => {
    const empty = await temp(probePackage, 'export const widgets = {};');
    await expect(bundle({ dir: empty })).rejects.toThrow(/the widgets map is empty/);
    const notComponents = await temp(probePackage, 'export const widgets = { echo: 1 };');
    await expect(bundle({ dir: notComponents })).rejects.toThrow(/not a React component/);
    const badName = await temp(probePackage, "export const widgets = { '9x': () => null };");
    await expect(bundle({ dir: badName })).rejects.toThrow(/widget name/);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';

// The probe manifest of the whole week, as "Fixed now" in the build spec.
export const SPEC_MANIFEST = {
  name: '@agentage/extension-probe',
  version: '0.1.0',
  engines: { agentage: '^0.9' },
  agentage: {
    id: 'probe',
    parts: {
      pages: true,
      ui: true,
      api: true,
      mcp: true,
      worker: true,
      cli: true,
      store: 'postgres',
    },
    commands: [{ name: 'ping', summary: 'Answers pong', args: [{ name: 'msg', type: 'string' }] }],
    settings: { 'mcp.listing': { type: 'string', default: 'open' } },
    secrets: [],
  },
};

export const API_MANIFEST: ExtensionPackage = {
  name: '@agentage/extension-probe',
  version: '0.1.0',
  engines: { agentage: '^0.9.0' },
  agentage: { id: 'probe', parts: { api: true } },
};

export const SHA = 'a'.repeat(40);

export const DIGEST = `sha256:${'b'.repeat(64)}`;

const made: string[] = [];

// A throwaway package folder: files maps relative paths to contents; removed after its test file.
export const tempPackage = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'agentage-kit-test-'));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
};

export const removeTempPackages = async (): Promise<void> => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
};

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

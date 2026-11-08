import { describe, expect, it } from 'vitest';
import { API_MANIFEST } from '../../test-support/packages.js';
import { crossPartImports, exportedPartCode } from './folders.js';

const CODE = `import { a } from './a.js';
import { b } from '../lib/b.js';
export * from '../api/c.js';
import '../../package.json';
const d = await import("../worker/d.js");
import type { F } from '../api/f.js';
export type {
  G,
} from '../api/g.js';`;

describe('folder rules', () => {
  it('a part may import its own folder and src/lib, nothing else', () => {
    expect(
      crossPartImports('src/mcp/index.ts', CODE).map(({ line, problem }) => [line, problem])
    ).toEqual([
      [3, 'imports ../api/c.js: a part imports only its own folder and src/lib'],
      [4, 'imports ../../package.json: a part imports only its own folder and src/lib'],
      [5, 'imports ../worker/d.js: a part imports only its own folder and src/lib'],
    ]);
    expect(crossPartImports('src/api/deep/x.ts', "import { e } from '../e.js';")).toEqual([]);
  });

  it('leaves src/lib and files outside a part folder to themselves', () => {
    expect(crossPartImports('src/lib/b.ts', "import '../api/x.js';")).toEqual([]);
    expect(crossPartImports('src/setup.ts', "import './api/x.js';")).toEqual([]);
  });

  it('refuses an export of part code, in any condition, and keeps the manifest and record', () => {
    const exports = {
      './package.json': './package.json',
      './agentage-extension.json': './dist/agentage-extension.json',
      './x': { types: './src/api/index.ts', default: ['./dist/worker/run.js'] },
      './lib': './src/lib/index.js',
      './root': './src/index.ts',
    };
    expect(exportedPartCode({ ...API_MANIFEST, exports } as typeof API_MANIFEST)).toEqual([
      {
        file: 'package.json',
        problem: 'exports ./src/api/index.ts: the package exports no part code',
      },
      {
        file: 'package.json',
        problem: 'exports ./dist/worker/run.js: the package exports no part code',
      },
    ]);
    const entry = {
      ...API_MANIFEST,
      agentage: { id: 'probe', parts: { api: { entry: './build/api.js' } } },
    };
    expect(
      exportedPartCode({ ...entry, exports: './build/api.js' } as typeof API_MANIFEST)
    ).toHaveLength(1);
    expect(exportedPartCode(API_MANIFEST)).toEqual([]);
  });
});

import { access, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { serverPartRecipe } from './recipe.js';

export const RECORD_FILE = 'agentage-extension.json';

const dependencySpecs = (pkg: ExtensionPackage): string[] => {
  const deps = (pkg as { dependencies?: unknown }).dependencies;
  if (typeof deps !== 'object' || deps === null) return [];
  return Object.values(deps).filter((spec): spec is string => typeof spec === 'string');
};

// `file:` tarball dependencies travel into the deps stage at the same relative path.
export const localTarballs = (pkg: ExtensionPackage): string[] =>
  dependencySpecs(pkg)
    .filter((spec) => spec.startsWith('file:') && spec.endsWith('.tgz'))
    .map((spec) => normalize(spec.slice('file:'.length)))
    .map((path) => {
      if (isAbsolute(path) || path.startsWith('..')) {
        throw new Error(`local dependency ${path} must live inside the package folder`);
      }
      return path;
    });

const copyInto = async (from: string, to: string): Promise<void> => {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
};

const copyDeps = async (dir: string, root: string, pkg: ExtensionPackage): Promise<void> => {
  await access(join(dir, 'package-lock.json')).catch(() => {
    throw new Error('package-lock.json is missing: the image installs with npm ci');
  });
  await copyInto(join(dir, 'package.json'), join(root, 'deps', 'package.json'));
  await copyInto(join(dir, 'package-lock.json'), join(root, 'deps', 'package-lock.json'));
  for (const path of localTarballs(pkg)) await copyInto(join(dir, path), join(root, 'deps', path));
};

const copyApp = async (dir: string, root: string): Promise<void> => {
  await copyInto(join(dir, 'package.json'), join(root, 'app', 'package.json'));
  await mkdir(join(root, 'app'), { recursive: true });
  await cp(join(dir, 'dist'), join(root, 'app', 'dist'), {
    recursive: true,
    filter: (source) => basename(source) !== RECORD_FILE,
  });
};

// A clean build context per part: only the manifest, the lockfile, local tarballs and dist/.
export const stageContext = async (
  dir: string,
  pkg: ExtensionPackage,
  part: ImagePartKind,
  tmpRoot: string = tmpdir()
): Promise<string> => {
  const root = await mkdtemp(join(tmpRoot, `agentage-${pkg.agentage.id}-${part}-`));
  await copyDeps(dir, root, pkg);
  await copyApp(dir, root);
  await writeFile(join(root, 'Dockerfile'), serverPartRecipe(part));
  return root;
};

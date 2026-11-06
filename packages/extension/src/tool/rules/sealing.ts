import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readJsonIfExists } from '../../manifest/read-manifest.js';
import { type CheckRule, type Finding } from '../check.js';

const CODE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

// extension-model section 9: the host owns ports, env, args and every other extension's address.
const SEALED: [RegExp, string][] = [
  [/\.\s*listen\s*\(/, 'calls listen()'],
  [/\bprocess\s*(?:\.|\[\s*['"`])\s*(env|argv)\b/, 'reads process.$1'],
  [/(?:from|import|require)\s*\(?\s*['"`](?:node:)?process['"`]/, 'imports process'],
  [/(?:https?:)?\/\/[\w.-]*agentage\.io\b/, 'names an absolute agentage URL'],
];

const lineFindings = (file: string, text: string): Finding[] =>
  text.split('\n').flatMap((code, i) =>
    SEALED.flatMap(([pattern, problem]) => {
      const match = pattern.exec(code);
      return match ? [{ file, line: i + 1, problem: problem.replace('$1', match[1] ?? '') }] : [];
    })
  );

// Every non-test source under src/; a symlink is refused, since it could point anywhere.
const sourceFindings = async (dir: string): Promise<Finding[]> => {
  const found = await readdir(join(dir, 'src'), { recursive: true, withFileTypes: true }).catch(
    () => []
  );
  const scanned = found
    .filter((entry) => CODE.test(entry.name) && !TEST.test(entry.name))
    .map(async (entry) => {
      const file = relative(dir, join(entry.parentPath, entry.name));
      if (entry.isSymbolicLink())
        return [{ file, problem: 'is a symlink: part code is plain files' }];
      return entry.isFile() ? lineFindings(file, await readFile(join(dir, file), 'utf8')) : [];
    });
  return (await Promise.all(scanned)).flat();
};

// An installed dependency whose package.json carries an agentage manifest is an extension.
const extensionDeps = async (dir: string, pkg: object): Promise<Finding[]> => {
  const { dependencies, optionalDependencies, peerDependencies } = pkg as Record<string, object>;
  const names = Object.keys({ ...dependencies, ...optionalDependencies, ...peerDependencies });
  const read = (name: string) => readJsonIfExists(join(dir, 'node_modules', name, 'package.json'));
  const manifests = await Promise.all(names.map(read));
  return names
    .filter((_, i) => Object.hasOwn(Object(manifests[i]), 'agentage'))
    .map((name) => ({ problem: `depends on another extension, ${name}` }));
};

export const sealing: CheckRule = {
  name: 'sealing',
  run: async ({ dir, pkg }) => [...(await sourceFindings(dir)), ...(await extensionDeps(dir, pkg))],
};

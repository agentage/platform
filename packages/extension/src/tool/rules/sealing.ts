import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readJsonIfExists } from '../../manifest/read-manifest.js';
import { type CheckRule, type Finding } from '../check.js';
import { crossPartImports } from './folders.js';

const CODE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
// Strings first, so a // inside one is no comment; a comment keeps its newlines for the line count.
const TOKENS =
  /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const QUOTED = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;

type Pattern = [RegExp, (match: RegExpExecArray) => string];

const QUOTE = '[\'"`]';
const GLOBAL = String.raw`\b(?:globalThis|global|self)\s*`;
// A value: read, passed, assigned or listed; not a key, a parameter or a name being declared.
const VALUE = String.raw`(?=[ \t]*(?:[.[),;\]}]|\?\.|\n|$))(?![ \t]*\}?\s*\)\s*(?:=>|\{|:)|\s*\}\s*[:=](?![=>]))`;
const PROCESS = String.raw`(?:${GLOBAL}\??\.\s*|(?<![.\w$:/-]|${QUOTE}))process\b${VALUE}`;

// extension-model section 9: ctx gives a part all it may read, so part code never uses process.
const ON_CODE: Pattern[] = [
  [
    new RegExp(String.raw`${PROCESS}(?:\s*(?:\?\.|\.|\[\s*${QUOTE})\s*(env|argv)\b)?`, 'g'),
    (m) => (m[1] ? `reads process.${m[1]}` : 'names process'),
  ],
  [
    new RegExp(String.raw`${GLOBAL}(?:\?\.)?\s*\[\s*${QUOTE}process${QUOTE}`, 'g'),
    () => 'names process',
  ],
  [/\blisten\s*(?:\?\.\s*)?\(|\[\s*['"`]listen['"`]\s*\]/g, () => 'calls listen()'],
];
const ON_STRINGS: Pattern[] = [
  [/(?:from|import|require)\s*\(?\s*['"`](?:node:)?process['"`]/g, () => 'imports process'],
  [/(?:https?:)?\/\/[^'"`\s]*agentage\.io/gi, () => 'names an absolute agentage URL'],
];

const matches = (file: string, text: string, patterns: Pattern[]): Finding[] =>
  patterns.flatMap(([pattern, problem]) =>
    [...text.matchAll(pattern)].map((m) => {
      const line = text.slice(0, m.index).split('\n').length;
      return { file, line, problem: problem(m) };
    })
  );

// Prose strings (with a space) are blanked; a name such as 'env' stays, as dynamic access spells it.
const fileFindings = (file: string, text: string): Finding[] => {
  const kept = text.replace(TOKENS, (t) => (t.startsWith('/') ? t.replace(/[^\n]/g, '') : t));
  const code = kept.replace(QUOTED, (s) => (/\s/.test(s) ? "''" : s));
  const found = [...matches(file, code, ON_CODE), ...matches(file, kept, ON_STRINGS)];
  return [...found, ...crossPartImports(file, kept)];
};

const LINKED = 'is a symlink: part code is plain files';

// Every non-test source under src/; any symlink met is refused, since it could point anywhere.
const sourceFindings = async (dir: string): Promise<Finding[]> => {
  const src = join(dir, 'src');
  const top = await lstat(src).catch(() => null);
  if (top?.isSymbolicLink()) return [{ file: 'src', problem: LINKED }];
  const found = top ? await readdir(src, { recursive: true, withFileTypes: true }) : [];
  const scanned = found.map(async (entry) => {
    const file = relative(dir, join(entry.parentPath, entry.name));
    if (entry.isSymbolicLink()) return [{ file, problem: LINKED }];
    if (!entry.isFile() || !CODE.test(entry.name) || TEST.test(entry.name)) return [];
    return fileFindings(file, await readFile(join(dir, file), 'utf8'));
  });
  return (await Promise.all(scanned)).flat();
};

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

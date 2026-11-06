import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { checkCli } from '../command/check-cli.js';
import { messageOf } from '../log/log.js';
import { PackageSchema, type ExtensionPackage } from '../manifest/manifest.schema.js';
import { entryOf, normalizeParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { formatIssues, readJsonIfExists } from '../manifest/read-manifest.js';
import { runCommand, type Run } from './exec.js';
import { problemLines } from './format.js';
import { sealing } from './rules/sealing.js';
import { store } from './rules/store.js';
import { surface } from './rules/surface.js';
import { KIT_VERSION } from './kit-version.js';
import { assertBuilt } from './stage.js';

export interface CheckOptions {
  run?: Run;
  // build never skips the store rule: without docker it is a problem, not a skip.
  requireDocker?: boolean;
  rules?: readonly CheckRule[];
}

export interface CheckInput extends CheckOptions {
  dir: string;
  pkg: ExtensionPackage;
  run: Run;
}

export interface Finding {
  file?: string;
  line?: number;
  problem: string;
}

export type CheckProblem = Finding & { rule: string };

// One conformance rule (extension-kit section 7): what it finds, or why it did not run.
export interface CheckRule {
  name: string;
  run(input: CheckInput): Promise<Finding[] | { skipped: string }>;
}

export interface CheckReport {
  id: string;
  version: string;
  conforms: boolean;
  rules: string[];
  problems: CheckProblem[];
  skipped: Record<string, string>;
}

const RECIPE = /^(?:dockerfile|containerfile)(?:\..+)?$|^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/i;

const manifest: CheckRule = {
  name: 'manifest',
  run: async ({ dir }) => {
    const value = await readJsonIfExists(join(dir, 'package.json')).catch((err: unknown) => {
      throw new Error(messageOf(err).replace(`${dir}/`, ''));
    });
    const issues = PackageSchema.safeParse(value).error?.issues ?? [];
    const recipes = (await readdir(dir)).filter((file) => RECIPE.test(file)).sort();
    const recipe = 'is not allowed: the kit writes every image recipe';
    return [
      ...issues.map((issue) => ({ problem: formatIssues([issue]) })),
      ...recipes.map((file) => ({ file, problem: recipe })),
    ];
  },
};

type Part = ImagePartKind | 'cli';

const problemsOf = (work: Promise<unknown>): Promise<string[]> =>
  work.then(
    (found) => (Array.isArray(found) ? found : []),
    (err: unknown) => [messageOf(err)]
  );

const exportProblems = async (dir: string, pkg: ExtensionPackage, part: Part) => {
  const mod = (await import(pathToFileURL(join(dir, entryOf(pkg, part))).href)) as object;
  const names = Object.keys(mod);
  if (!names.includes('create')) return [`part ${part} does not export create`];
  if (typeof (mod as { create: unknown }).create !== 'function')
    return [`part ${part} create is not a function`];
  const others = names.filter((name) => name !== 'create');
  return others.length > 0 ? [`part ${part} exports ${others.join(', ')} beside create`] : [];
};

const partProblems = async ({ dir, pkg }: CheckInput, part: Part): Promise<string[]> => {
  const built = part === 'cli' ? [] : await problemsOf(assertBuilt(dir, pkg, part));
  if (built.length > 0 || part === 'ui') return built;
  const own = await problemsOf(exportProblems(dir, pkg, part));
  const cli = own.length === 0 && part === 'cli' ? await checkCli(dir) : null;
  return cli ? [`cli part: ${cli}`] : own;
};

// Every part built where its image looks, exporting create and nothing else; cli handlers = commands.
const entries: CheckRule = {
  name: 'entries',
  run: async (input) => {
    const parts = Object.keys(normalizeParts(input.pkg.agentage.parts).code) as Part[];
    const found = await Promise.all(parts.map((part) => partProblems(input, part)));
    return found.flat().map((problem) => ({ problem }));
  },
};

const MAJORS = { express: '^5', zod: '^4', '@modelcontextprotocol/server': '^2' };
const KIT = '@agentage/extension';

const specProblem = (name: string, spec: string, needed: string): string[] => {
  if (!spec.trim() || !semver.validRange(spec))
    return [`${name} ${spec || '""'} needs a version range`];
  return semver.subset(spec, needed) ? [] : [`${name} ${spec}, needs ${needed}`];
};

const stack: CheckRule = {
  name: 'stack',
  run: async ({ pkg }) => {
    const deps = (pkg as { dependencies?: Record<string, string> }).dependencies ?? {};
    const range = pkg.engines.agentage;
    const found = Object.entries({ ...MAJORS, [KIT]: range }).flatMap(([name, needed]) => {
      const spec = deps[name];
      // This repo's CI installs the packed kit into a probe clone as a file: tarball.
      if (spec === undefined || (name === KIT && spec.startsWith('file:'))) return [];
      return specProblem(name, spec, needed);
    });
    if ('@modelcontextprotocol/sdk' in deps)
      found.push('@modelcontextprotocol/sdk is MCP SDK 1: use @modelcontextprotocol/server ^2');
    if (!semver.satisfies(KIT_VERSION, range))
      found.push(`kit ${KIT_VERSION} is outside engines.agentage ${range}`);
    return found.map((problem) => ({ problem }));
  },
};

// The closed list of extension-kit section 7, in its order; build runs it before any image.
export const RULES: readonly CheckRule[] = [manifest, entries, surface, stack, store, sealing];

const runRule = (rule: CheckRule, input: CheckInput) =>
  rule.run(input).catch((err: unknown) => [{ problem: messageOf(err) }]);

export const check = async (dir: string, options: CheckOptions = {}): Promise<CheckReport> => {
  const { rules = RULES, run = runCommand } = options;
  const read = readJsonIfExists(join(dir, 'package.json')).catch(() => ({}));
  const pkg = ((await read) ?? {}) as ExtensionPackage;
  const problems: CheckProblem[] = [];
  const skipped: Record<string, string> = {};
  for (const rule of rules) {
    const result = await runRule(rule, { ...options, dir, pkg, run });
    if ('skipped' in result) skipped[rule.name] = result.skipped;
    else problems.push(...result.map((found) => ({ rule: rule.name, ...found })));
    if (rule.name === 'manifest' && problems.length > 0) break;
  }
  const names = rules.map((rule) => rule.name);
  const conforms = problems.length === 0;
  return { id: pkg.agentage?.id, version: pkg.version, conforms, rules: names, problems, skipped };
};

// What build runs after the compile and before any image: any problem stops everything.
export const assertConforms = async (dir: string, options: CheckOptions = {}): Promise<void> => {
  const report = await check(dir, { ...options, requireDocker: true });
  const lines = problemLines(report).map((line) => `check failed: ${line}`);
  if (!report.conforms) throw new Error(lines.join('\n'));
};

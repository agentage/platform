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
import { assertBuilt, exists } from './stage.js';

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

const RECIPES = ['Dockerfile', 'compose.yml', 'compose.yaml', 'docker-compose.yml'];

// pkg is package.json as read: this rule is the one that validates it.
const manifest: CheckRule = {
  name: 'manifest',
  run: async ({ dir, pkg }) => {
    const issues = PackageSchema.safeParse(pkg).error?.issues ?? [];
    const found = await Promise.all(RECIPES.map((file) => exists(join(dir, file))));
    const recipes = RECIPES.filter((_, i) => found[i]);
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
  const names = Object.keys(await import(pathToFileURL(join(dir, entryOf(pkg, part))).href));
  if (!names.includes('create')) return [`part ${part} does not export create`];
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

// Declared ranges only; a spec that is no semver range (a local tarball) is not judged.
const stack: CheckRule = {
  name: 'stack',
  run: async ({ pkg }) => {
    const deps = (pkg as { dependencies?: Record<string, string> }).dependencies ?? {};
    const needs = { ...MAJORS, '@agentage/extension': pkg.engines.agentage };
    return Object.entries(needs).flatMap(([name, needed]) => {
      const spec = deps[name];
      if (!spec || !semver.validRange(spec) || semver.subset(spec, needed)) return [];
      return [{ problem: `${name} ${spec}, needs ${needed}` }];
    });
  },
};

// The closed list of extension-kit section 7, in its order; build runs it before any image.
export const RULES: readonly CheckRule[] = [manifest, entries, surface, stack, store, sealing];

const runRule = (rule: CheckRule, input: CheckInput) =>
  rule.run(input).catch((err: unknown) => [{ problem: messageOf(err) }]);

// Every rule in order; an invalid manifest stops the rest, which all read it.
export const check = async (dir: string, options: CheckOptions = {}): Promise<CheckReport> => {
  const { rules = RULES, run = runCommand } = options;
  const pkg = ((await readJsonIfExists(join(dir, 'package.json'))) ?? {}) as ExtensionPackage;
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
  if (!report.conforms) throw new Error(`check failed: ${problemLines(report).join('; ')}`);
};

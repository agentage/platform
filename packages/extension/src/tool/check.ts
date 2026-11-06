import { readdir } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
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
import { assertBuilt, exists } from './stage.js';

export interface CheckOptions {
  run?: Run;
  // build never skips the store rule: without docker it is a problem, not a skip.
  requireDocker?: boolean;
  rules?: readonly CheckRule[];
}

export type CheckInput = CheckOptions & { dir: string; pkg: ExtensionPackage; run: Run };

export type Finding = { file?: string; line?: number; problem: string };

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

const NO_PACKAGE = 'is missing: run it in an extension package folder';

const manifest: CheckRule = {
  name: 'manifest',
  run: async ({ dir }) => {
    const value = await readJsonIfExists(join(dir, 'package.json'));
    if (value === undefined) return [{ file: 'package.json', problem: NO_PACKAGE }];
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

const exportProblem = async (dir: string, pkg: ExtensionPackage, part: Part) => {
  const href = pathToFileURL(join(dir, entryOf(pkg, part))).href;
  const mod = (await import(href).catch((err: unknown) => {
    throw new Error(`part ${part} fails at import: ${messageOf(err)}`);
  })) as object;
  const others = Object.keys(mod).filter((name) => name !== 'create');
  if (typeof (mod as { create?: unknown }).create !== 'function')
    return `part ${part} does not export create${'create' in mod ? ' as a function' : ''}`;
  if (others.length > 0) return `part ${part} exports ${others.join(', ')} beside create`;
  const cli = part === 'cli' ? await checkCli(dir) : null;
  return cli && `cli part: ${cli}`;
};

const partProblem = async ({ dir, pkg }: CheckInput, part: Part): Promise<string | null> => {
  if (part !== 'cli') await assertBuilt(dir, pkg, part);
  else if (!(await exists(join(dir, entryOf(pkg, part)))))
    return `${normalize(entryOf(pkg, part))} not found: the package build must write the cli part there`;
  return part === 'ui' ? null : exportProblem(dir, pkg, part);
};

// Every part built where its image looks, exporting create and nothing else; cli handlers = commands.
const entries: CheckRule = {
  name: 'entries',
  run: async (input) => {
    if (!(await exists(join(input.dir, 'dist'))))
      return [{ file: 'dist', problem: 'is missing: build the package first (npm run build)' }];
    const parts = Object.keys(normalizeParts(input.pkg.agentage.parts).code) as Part[];
    const found = parts.map((part) => partProblem(input, part).catch(messageOf));
    return (await Promise.all(found)).flatMap((problem) => (problem ? [{ problem }] : []));
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

// A thrown message names its file relative to the package, as every problem line does.
const runRule = (rule: CheckRule, input: CheckInput) =>
  rule.run(input).catch((err) => [{ problem: messageOf(err).replace(`${input.dir}/`, '') }]);

export const check = async (at: string, options: CheckOptions = {}): Promise<CheckReport> => {
  const { rules = RULES, run = runCommand } = options;
  const dir = resolve(at);
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

import { checkCli } from '../command/check-cli.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { imageParts, normalizeParts } from '../manifest/parts.js';
import { assertBuilt } from './stage.js';

export interface CheckInput {
  dir: string;
  pkg: ExtensionPackage;
}

// One conformance rule (extension-kit section 7): the problems it finds, none when the package passes.
export interface CheckRule {
  name: string;
  run(input: CheckInput): Promise<string[]>;
}

export interface CheckProblem {
  rule: string;
  problem: string;
}

const problemsOf = (work: Promise<unknown>): Promise<string[]> =>
  work.then(
    () => [],
    (err: unknown) => [(err as Error).message]
  );

// Every image part built where its image looks for it; the cli handlers are exactly the commands.
const entries: CheckRule = {
  name: 'entries',
  run: async ({ dir, pkg }) => {
    const built = imageParts(pkg).map((part) => problemsOf(assertBuilt(dir, pkg, part)));
    const cli = normalizeParts(pkg.agentage.parts).code.cli ? await checkCli(dir) : null;
    return [...(await Promise.all(built)).flat(), ...(cli ? [`cli part: ${cli}`] : [])];
  },
};

// Kit 0.2 has the entries rule; M4 adds manifest, surface, stack, store and sealing beside it.
export const RULES: readonly CheckRule[] = [entries];

export const check = async (input: CheckInput, rules = RULES): Promise<CheckProblem[]> => {
  const found: CheckProblem[] = [];
  for (const rule of rules)
    for (const problem of await rule.run(input)) found.push({ rule: rule.name, problem });
  return found;
};

// What build runs after the compile and before any image: one failure stops everything.
export const assertConforms = async (input: CheckInput, rules = RULES): Promise<void> => {
  const problems = await check(input, rules);
  if (problems.length === 0) return;
  throw new Error(`check failed: ${problems.map((p) => `${p.rule}: ${p.problem}`).join('; ')}`);
};

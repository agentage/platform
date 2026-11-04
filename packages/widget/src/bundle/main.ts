import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { bundle, type BundleResult } from './bundle.js';

export interface Output {
  log(line: string): void;
  error(line: string): void;
}

export const USAGE = 'usage: agentage-widget bundle [--dir <extension>]';

const parse = (argv: string[]) =>
  parseArgs({
    args: argv,
    allowPositionals: true,
    options: { dir: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });

const lines = (result: BundleResult): string[] => {
  const rel = (file: string) => relative(process.cwd(), file) || '.';
  return [
    `module   ${rel(result.files.module)}`,
    `widgets  ${rel(result.files.widgets)}  ${result.widgets.map((w) => w.element).join(' ')}`,
    `harness  ${rel(result.files.harness)}`,
  ];
};

// Exit codes: 0 ok, 1 failure, 2 usage.
export const main = async (argv: string[], out: Output): Promise<number> => {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (error) {
    out.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (args.values.help) return (out.log(USAGE), 0);
  if (args.positionals.length !== 1 || args.positionals[0] !== 'bundle')
    return (out.error(USAGE), 2);
  try {
    lines(await bundle({ dir: args.values.dir })).forEach((line) => out.log(line));
    return 0;
  } catch (error) {
    out.error(`bundle failed: ${(error as Error).message}`);
    return 1;
  }
};

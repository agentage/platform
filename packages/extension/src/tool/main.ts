import { parseArgs } from 'node:util';
import { build, type BuildOptions, type BuildResult } from './build.js';
import { buildLines } from './format.js';

export interface MainDeps {
  build: (options: BuildOptions) => Promise<BuildResult>;
  out: (line: string) => void;
  err: (line: string) => void;
}

export const USAGE = `usage: agentage-extension build [--push] [--dir <path>] [--registry <host/owner>]

  build      one image per server part from the kit recipe
  --push     push the images and write dist/agentage-extension.json with their digests
  --dir      the extension package folder (default: the current folder)
  --registry image registry and owner (default: ghcr.io/agentage)`;

const defaultDeps: MainDeps = {
  build: (options) => build(options),
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
};

const parse = (argv: string[]) =>
  parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      push: { type: 'boolean' },
      dir: { type: 'string' },
      registry: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

const runBuild = async (options: BuildOptions, deps: MainDeps): Promise<number> => {
  try {
    for (const line of buildLines(await deps.build(options))) deps.out(line);
    return 0;
  } catch (err) {
    deps.err(`build failed: ${(err as Error).message}`);
    return 1;
  }
};

// Exit codes: 0 ok, 1 the build failed, 2 usage.
export const main = async (argv: string[], deps: MainDeps = defaultDeps): Promise<number> => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    deps.err(`${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const { positionals, values } = parsed;
  if (values.help) return (deps.out(USAGE), 0);
  if (positionals[0] !== 'build' || positionals.length !== 1) return (deps.err(USAGE), 2);
  return runBuild({ push: values.push, dir: values.dir, registry: values.registry }, deps);
};

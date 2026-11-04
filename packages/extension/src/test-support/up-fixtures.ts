import { type Run, type RunOptions } from '../tool/exec.js';
import { linkModules } from './http.js';
import { json, SHA, SPEC_MANIFEST, tempPackage } from './packages.js';

export const ENV = { COMMIT_SHA: SHA, BUILD_TIME: '2026-11-05T10:00:00Z' };
export const IMAGE_ID = `sha256:${'e'.repeat(64)}`;
const SERVICES = ['pages', 'ui', 'api', 'mcp', 'worker', 'gateway', 'issuer', 'store'];

export const PROBE = {
  ...SPEC_MANIFEST,
  version: '0.2.0',
  engines: { agentage: '^0.2' },
  scripts: { build: 'tsc' },
  agentage: {
    ...SPEC_MANIFEST.agentage,
    commands: [
      {
        name: 'ping',
        summary: 'Answers pong',
        args: [{ name: 'msg', type: 'string', optional: true }],
      },
    ],
  },
};

const MCP = `import { z } from 'zod';
export const create = (ctx) => ctx.tool('echo', { description: 'Echo', input: z.object({}), output: z.object({}) }, () => ({}));
`;

export const probeDir = async (
  manifest: object = PROBE,
  cli = "export const create = ({ out }) => ({ ping: () => out.log('pong') });"
) => {
  const create = 'export const create = () => null;';
  const dir = await tempPackage({
    'package.json': json(manifest),
    'package-lock.json': json({ lockfileVersion: 3 }),
    'dist/pages/index.js': create,
    'dist/api/index.js': create,
    'dist/worker/index.js': create,
    'dist/mcp/index.js': MCP,
    'dist/ui/probe.js': 'export {};',
    'dist/ui/widgets.json': json([
      { name: 'echo', element: 'probe-echo', module: '/ui/0.2.0/probe.js' },
    ]),
    'dist/cli/index.js': cli,
    'migrations/001-ticks.sql': 'create table ticks (id int);',
    'seeds/001-hello.sql': 'insert into ticks values (1);',
  });
  await linkModules(dir);
  return dir;
};

// npm, docker build and inspect, and compose: ps answers from `health`, migrate prints its summary.
export const fakeDocker = (health: Record<string, string> = {}) => {
  const calls: { args: string[]; options?: RunOptions }[] = [];
  const answer = (args: string[]): string => {
    if (args[0] === 'image') return `${IMAGE_ID}\n`;
    if (args.includes('ps'))
      return SERVICES.map((s) =>
        JSON.stringify({ Service: s, State: 'running', Health: health[s] ?? 'healthy' })
      ).join('\n');
    if (args.includes('run')) return 'migrated\n{"migrations":1,"applied":1,"seeds":1}\n';
    return '';
  };
  const run: Run = async (command, args, options) => {
    calls.push({ args: [command, ...args], options });
    return { code: 0, stdout: answer(args), stderr: '' };
  };
  const compose = () =>
    calls.filter((c) => c.args[1] === 'compose').map((c) => c.args.slice(6).join(' '));
  return { run, calls, compose };
};

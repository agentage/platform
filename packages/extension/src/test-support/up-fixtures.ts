import { type Run, type RunOptions } from '../tool/exec.js';
import { linkModules } from './http.js';
import { json, SHA, SPEC_MANIFEST, tempPackage } from './packages.js';

export const ENV = { COMMIT_SHA: SHA, BUILD_TIME: '2026-11-05T10:00:00Z' };
export const IMAGE_ID = `sha256:${'e'.repeat(64)}`;
const SERVICES = ['pages', 'ui', 'api', 'mcp', 'worker', 'gateway', 'issuer', 'store'];

export const PROBE = {
  ...SPEC_MANIFEST,
  version: '0.2.0',
  engines: { agentage: '^0.6' },
  scripts: { build: 'tsc' },
  agentage: {
    ...SPEC_MANIFEST.agentage,
    commands: [
      {
        name: 'ping',
        summary: 'Answers pong',
        args: [{ name: 'msg', type: 'string', required: false }],
      },
    ],
  },
};

const MCP = `import { z } from 'zod';
export const create = (ctx) => ctx.tool('echo', { description: 'Echo', input: z.object({}), output: z.object({}) }, () => ({}));
`;

const CREATE = 'export const create = () => null;';

const PROBE_FILES = {
  'package-lock.json': json({ lockfileVersion: 3 }),
  'dist/pages/index.js': CREATE,
  'dist/api/index.js': CREATE,
  'dist/worker/index.js': CREATE,
  'dist/mcp/index.js': MCP,
  'dist/ui/probe.js': 'export {};',
  'dist/ui/widgets.json': json([
    { name: 'echo', element: 'probe-echo', module: '/ui/0.2.0/probe.js' },
  ]),
  'migrations/001-ticks.sql': 'create table ticks (id int);',
  'seeds/001-hello.sql': 'insert into ticks values (1);',
};

const SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };
const ECHO = {
  name: 'probe__echo',
  description: 'Echo',
  inputSchema: { ...SCHEMA, properties: {} },
  outputSchema: { ...SCHEMA, properties: {}, additionalProperties: false },
};

// The committed contracts the surface rule compares with what the fixture parts serve.
const contracts = (version: string) => ({
  'openapi.json': json({ openapi: '3.1.0', info: { title: 'probe', version }, paths: {} }),
  'probe.mcpc.json': json({ serverInfo: { name: 'agentage-probe', version }, tools: [ECHO] }),
});

export const probeDir = async (
  manifest: { version: string; [key: string]: unknown } = PROBE,
  cli = "export const create = ({ out }) => ({ ping: () => out.log('pong') });"
) => {
  const files = {
    'package.json': json(manifest),
    ...PROBE_FILES,
    ...contracts(manifest.version),
    'dist/cli/index.js': cli,
  };
  const dir = await tempPackage(files);
  await linkModules(dir);
  return dir;
};

export const MIGRATED = 'migrated\n{"migrations":1,"applied":1,"seeds":1,"seedsBefore":0}\n';

export interface FakeDockerOptions {
  // What `docker ps --format` prints, per call (the last one repeats): name, project, ports.
  running?: string[];
  migrate?: string;
  // The migrate job exits 1 with this on stderr.
  migrateFails?: string;
  // What a part's /health answers inside its container; default ok with this build's commit.
  bodies?: Record<string, string>;
}

const okBody = (part: string) => json({ success: true, data: { status: 'ok', commit: SHA, part } });

// npm, docker build and inspect, and compose: ps answers from `health`, migrate prints its summary.
export const fakeDocker = (health: Record<string, string> = {}, fake: FakeDockerOptions = {}) => {
  const calls: { args: string[]; options?: RunOptions }[] = [];
  const running = [...(fake.running ?? [''])];
  const answer = (args: string[]): string => {
    if (args[0] === 'image') return `${IMAGE_ID}\n`;
    if (args[0] === 'ps') return (running.length > 1 ? running.shift() : running[0]) ?? '';
    if (args.includes('ps'))
      return SERVICES.map((s) =>
        JSON.stringify({ Service: s, State: 'running', Health: health[s] ?? 'healthy' })
      ).join('\n');
    if (args.includes('run')) return fake.migrate ?? MIGRATED;
    if (args.includes('exec')) {
      const part = args[args.indexOf('exec') + 2] ?? '';
      return fake.bodies?.[part] ?? okBody(part);
    }
    return '';
  };
  const run: Run = async (command, args, options) => {
    calls.push({ args: [command, ...args], options });
    if (fake.migrateFails && args.includes('migrate'))
      return { code: 1, stdout: '', stderr: fake.migrateFails };
    return { code: 0, stdout: answer(args), stderr: '' };
  };
  const compose = () =>
    calls.filter((c) => c.args[1] === 'compose').map((c) => c.args.slice(6).join(' '));
  return { run, calls, compose };
};

import { mustRun, type Run } from './exec.js';
import { TIMEOUTS } from './timeouts.js';

export interface DockerBuild {
  context: string;
  tag: string;
  buildArgs: Record<string, string>;
  labels: Record<string, string>;
}

export interface Docker {
  build(options: DockerBuild): Promise<void>;
  push(tag: string): Promise<string>;
}

const PLATFORM = 'linux/amd64';

const flags = (flag: string, values: Record<string, string>): string[] =>
  Object.entries(values).flatMap(([key, value]) => [flag, `${key}=${value}`]);

// No provenance attestation: the pushed digest is then the image itself, as the record expects.
export const buildArgsOf = (options: DockerBuild): string[] => [
  'build',
  '--platform',
  PLATFORM,
  '--provenance=false',
  '--tag',
  options.tag,
  ...flags('--build-arg', options.buildArgs),
  ...flags('--label', options.labels),
  options.context,
];

export const digestOf = (pushOutput: string): string => {
  const match = /digest: (sha256:[0-9a-f]{64})/.exec(pushOutput);
  if (!match?.[1]) throw new Error('docker push printed no digest');
  return match[1];
};

export const createDocker = (run: Run): Docker => ({
  build: async (options) => {
    await mustRun(run, 'docker', buildArgsOf(options), { timeoutMs: TIMEOUTS.build });
  },
  push: async (tag) =>
    digestOf(await mustRun(run, 'docker', ['push', tag], { echo: true, timeoutMs: TIMEOUTS.push })),
});

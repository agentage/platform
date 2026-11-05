import { mustRun, type Run } from '../exec.js';
import { GATEWAY_PORT, ISSUER_PORT } from './gateway.js';

interface Holder {
  name: string;
  project: string;
  ports: string;
}

const FORMAT = '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Ports}}';

const runningContainers = async (run: Run): Promise<Holder[]> =>
  (await mustRun(run, 'docker', ['ps', '--format', FORMAT]))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name = '', project = '', ports = ''] = line.split('\t');
      return { name, project, ports };
    });

const heldPort = (holder: Holder): number | undefined =>
  [GATEWAY_PORT, ISSUER_PORT].find((port) => holder.ports.includes(`:${port}->`));

const refusal = (holder: Holder, port: number): Error =>
  new Error(
    holder.project
      ? `localhost:${port} is held by compose project ${holder.project}: run agentage extension down in the working copy that started it, then up again`
      : `localhost:${port} is held by container ${holder.name}: stop it, then up again`
  );

// Before anything starts: the gateway and issuer ports are free, or this working copy's own.
export const assertPortsFree = async (run: Run, project: string): Promise<void> => {
  for (const holder of await runningContainers(run)) {
    const port = heldPort(holder);
    if (port !== undefined && holder.project !== project) throw refusal(holder, port);
  }
};

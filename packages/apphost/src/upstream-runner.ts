import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { type Exit, type LaunchSpec } from './child.js';
import { portOf, type Run, type Runner, type RunState } from './runner.js';

// An origin only: scheme, host and port; no user, password, path, query or fragment.
const ORIGIN = /^https?:\/\/[^/?#@]+$/;

// One row of an app host's upstreams.json (the app host repo): a running service of one extension.
export const UpstreamSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  service: z.string().min(1),
  address: z.url({ protocol: /^https?$/ }).regex(ORIGIN, 'an upstream address is an origin only'),
});
export const UpstreamListSchema = z.array(UpstreamSchema);
export type Upstream = z.infer<typeof UpstreamSchema>;

export const readUpstreams = async (file: string): Promise<Upstream[]> =>
  UpstreamListSchema.parse(JSON.parse(await readFile(file, 'utf8')));

// The state of an id as the discovery of the host sees it: the runner never probes an upstream.
export type StateOf = (id: string) => 'running' | 'down';

export interface UpstreamOptions {
  upstreams: Upstream[];
  stateOf: StateOf;
}

// Every row of an id (api and pages are two services), in list order: the first answer wins.
const rowsOf = (upstreams: Upstream[], id: string): Upstream[] => {
  const rows = upstreams.filter((row) => row.id === id);
  if (!rows.length) throw new Error(`no upstream for ${id} in the upstream list`);
  return rows;
};

const connect = (rows: Upstream[], stateOf: StateOf): Run => {
  let stopped = false;
  const { promise: exited, resolve: done } = Promise.withResolvers<Exit>();
  const [first] = rows as [Upstream, ...Upstream[]];
  return {
    // No local process: the service runs in its own container.
    pid: 0,
    port: portOf(first.address),
    exited,
    address: () => first.address,
    addresses: () => rows.map((row) => row.address),
    state: (): RunState => (stopped ? 'exited' : stateOf(first.id)),
    stop: async () => {
      stopped = true;
      done({ code: null, signal: null });
    },
  };
};

// The upstream runner (J.4.4 row 1): it starts nothing; it gives the listed addresses of an id.
// A run is ready at once: whether it serves is the discovery state (one source), never /health.
export const upstreamRunner = ({ upstreams, stateOf }: UpstreamOptions): Runner => ({
  kind: 'upstream',
  readsPackage: false,
  start: async (spec: Pick<LaunchSpec, 'id'>) => connect(rowsOf(upstreams, spec.id), stateOf),
});

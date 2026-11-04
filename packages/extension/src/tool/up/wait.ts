import { type Run } from '../exec.js';
import { compose, states, type ComposeTarget, type ServiceState } from './compose-run.js';

export interface WaitDeps {
  run: Run;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const broken = (state: ServiceState | undefined): boolean =>
  state !== undefined &&
  (state.health === 'unhealthy' || state.state === 'exited' || state.state === 'dead');

const logsOf = async (run: Run, target: ComposeTarget, service: string): Promise<string> =>
  compose(run, target, ['logs', '--no-color', '--tail', '20', service]).catch(() => '');

const failure = async (run: Run, target: ComposeTarget, state: ServiceState, why: string) =>
  new Error(`${state.service} ${why}\n${(await logsOf(run, target, state.service)).trim()}`);

// Every named service healthy (its HEALTHCHECK on 127.0.0.1), or the first broken one with its log.
export const waitHealthy = async (target: ComposeTarget, services: string[], deps: WaitDeps) => {
  const deadline = Date.now() + (deps.timeoutMs ?? 180_000);
  for (;;) {
    const byService = new Map((await states(deps.run, target)).map((s) => [s.service, s]));
    const bad = services.map((name) => byService.get(name)).find(broken);
    if (bad) throw await failure(deps.run, target, bad, `is ${bad.health || bad.state}`);
    if (services.every((name) => byService.get(name)?.health === 'healthy')) return;
    if (Date.now() > deadline) {
      const waiting = services.filter((name) => byService.get(name)?.health !== 'healthy');
      throw new Error(
        `not healthy after ${Math.round((deps.timeoutMs ?? 180_000) / 1000)} s: ${waiting.join(', ')}`
      );
    }
    await (deps.sleep ?? pause)(1000);
  }
};

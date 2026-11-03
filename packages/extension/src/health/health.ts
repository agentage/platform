import { randomBytes } from 'node:crypto';
import { type RequestHandler } from 'express';
import { type BuildInfo } from '../discovery/discovery.js';
import { fail } from '../envelope/envelope.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { isoSeconds } from '../runtime/build-info.js';
import { type HealthBody, type HealthStatus } from './health.schema.js';

export type HealthCheck = () => Promise<HealthStatus>;

export interface HealthOptions {
  extension: string;
  part: ImagePartKind;
  version: string;
  build: BuildInfo;
  checks?: Record<string, HealthCheck>;
  instance?: string;
  startedAt?: number;
  now?: () => Date;
}

const RANK: Record<HealthStatus, number> = { ok: 0, degraded: 1, unavailable: 2 };

export const worstOf = (statuses: HealthStatus[]): HealthStatus =>
  statuses.reduce<HealthStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'ok');

const runChecks = async (checks: Record<string, HealthCheck>) => {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      const status = await check().catch((): HealthStatus => 'unavailable');
      return [name, status] as const;
    })
  );
  return Object.fromEntries(entries) as Record<string, HealthStatus>;
};

export const isLoopback = (address: string | undefined): boolean =>
  address !== undefined && /^(127\.|::1$|::ffff:127\.)/.test(address);

export type ResolvedHealth = HealthOptions &
  Required<Pick<HealthOptions, 'instance' | 'startedAt'>>;

export const healthBody = async (options: ResolvedHealth): Promise<HealthBody> => {
  const now = (options.now ?? (() => new Date()))();
  const checks = await runChecks(options.checks ?? {});
  const status = worstOf(Object.values(checks));
  const { extension, part, version, build, instance } = options;
  const uptimeSeconds = Math.max(0, Math.floor((now.getTime() - options.startedAt) / 1000));
  const data = { status, extension, part, version, ...build, instance };
  return {
    success: status !== 'unavailable',
    data: { ...data, uptimeSeconds, checkedAt: isoSeconds(now), checks },
  };
};

// Answers only on loopback: the container HEALTHCHECK and an operator on the node, never the gateway.
export const createHealthHandler = (options: HealthOptions): RequestHandler => {
  const resolved: ResolvedHealth = {
    ...options,
    instance: options.instance ?? randomBytes(4).toString('hex'),
    startedAt: options.startedAt ?? Date.now(),
  };
  return async (req, res) => {
    if (!isLoopback(req.socket.localAddress)) throw fail('NOT_FOUND', 'Not found');
    const body = await healthBody(resolved);
    res.setHeader('Cache-Control', 'no-store');
    res.status(body.data.status === 'unavailable' ? 503 : 200).json(body);
  };
};

import { randomBytes } from 'node:crypto';
import { type RequestHandler } from 'express';
import { type BuildInfo } from '../discovery/discovery.js';
import { fail } from '../envelope/envelope.js';
import { type Log } from '../log/log.js';
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
  // Writes a health.changed event on a transition, never on every probe.
  log?: Log;
}

const RANK: Record<HealthStatus, number> = { ok: 0, degraded: 1, unavailable: 2 };

export const worstOf = (statuses: HealthStatus[]): HealthStatus =>
  statuses.reduce<HealthStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'ok');

// Under the recipe's HEALTHCHECK --timeout=3s: a hung check reads unavailable, never a hung probe.
export const CHECK_TIMEOUT_MS = 1000;

const settle = async (check: HealthCheck): Promise<HealthStatus> => {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<HealthStatus>((resolve) => {
    timer = setTimeout(() => resolve('unavailable'), CHECK_TIMEOUT_MS).unref();
  });
  try {
    return await Promise.race([check(), expiry]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
};

const runChecks = async (checks: Record<string, HealthCheck>) => {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => [name, await settle(check)] as const)
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

type Checks = Record<string, HealthStatus>;

// Names a check whose status moved, so a recovery names what recovered.
const changed = (
  log: Log | undefined,
  from: HealthStatus,
  to: HealthStatus,
  was: Checks,
  now: Checks
) => {
  const check = Object.keys(now).find((name) => was[name] !== now[name]) ?? '';
  const fields = {
    'agentage.health.from': from,
    'agentage.health.to': to,
    'agentage.health.check': check,
  };
  log?.event('health.changed', fields, `health.changed ${from} to ${to}`);
};

// Answers only on loopback: the container HEALTHCHECK and an operator on the node, never the gateway.
export const createHealthHandler = (options: HealthOptions): RequestHandler => {
  const resolved: ResolvedHealth = {
    ...options,
    instance: options.instance ?? randomBytes(4).toString('hex'),
    startedAt: options.startedAt ?? Date.now(),
  };
  let last: HealthStatus | undefined;
  let lastChecks: Checks = {};
  return async (req, res) => {
    if (!isLoopback(req.socket.localAddress)) throw fail('NOT_FOUND', 'Not found');
    const body = await healthBody(resolved);
    const { status: to, checks } = body.data;
    if (last !== undefined && last !== to) changed(options.log, last, to, lastChecks, checks);
    [last, lastChecks] = [to, checks];
    res.setHeader('Cache-Control', 'no-store');
    res.status(body.data.status === 'unavailable' ? 503 : 200).json(body);
  };
};

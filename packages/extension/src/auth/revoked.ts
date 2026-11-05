import { z } from 'zod';
import { type HealthCheck } from '../health/health.js';
import { messageOf, type Log } from '../log/log.js';
import { retryOnce } from './token-check.js';

export const REVOKED_POLL_MS = 30_000;
const STALE_MS = 5 * 60_000;

const RevokedSchema = z.object({
  revoked: z.array(z.object({ jti: z.string(), exp: z.number() })),
  generatedAt: z.string(),
});

const readList = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`the issuer answered ${res.status}`);
  return new Set(RevokedSchema.parse(await res.json()).revoked.map((entry) => entry.jti));
};

// The issuer's revoked ids, read every 30 s so a revoke holds within 60 s (api-standards 5).
export const createRevokedList = (issuer: string, log: Log, now = Date.now) => {
  let ids = new Set<string>();
  let readAt: number | undefined;
  const refresh = async () => {
    try {
      ids = await retryOnce(() => readList(`${issuer}/.well-known/agentage-revoked`));
      readAt = now();
    } catch (err) {
      log.warn('revoked list not read', { reason: messageOf(err) });
    }
  };
  const loaded = () => readAt !== undefined;
  const fresh = () => readAt !== undefined && now() - readAt <= STALE_MS;
  const check: HealthCheck = async () => (fresh() ? 'ok' : 'degraded');
  return { has: (jti: string) => ids.has(jti), loaded, refresh, check };
};

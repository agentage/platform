import { z } from 'zod';
import { type HealthCheck } from '../health/health.js';
import { type Log } from '../log/log.js';

export const REVOKED_POLL_MS = 30_000;
const STALE_MS = 5 * 60_000;
const READ_TIMEOUT_MS = 5000;

const RevokedSchema = z.object({
  revoked: z.array(z.object({ jti: z.string(), exp: z.number() })),
  generatedAt: z.string(),
});

// The issuer's revoked ids, read every 30 s so a revoke holds within 60 s (api-standards 5).
export const createRevokedList = (issuer: string, log: Log, now = Date.now) => {
  let ids = new Set<string>();
  // Counted from start until the first read, so a part is not degraded while it boots.
  let readAt = now();
  const refresh = async () => {
    try {
      const url = `${issuer}/.well-known/agentage-revoked`;
      const res = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`the issuer answered ${res.status}`);
      ids = new Set(RevokedSchema.parse(await res.json()).revoked.map((entry) => entry.jti));
      readAt = now();
    } catch (err) {
      log.warn('revoked list not read', { reason: (err as Error).message });
    }
  };
  const check: HealthCheck = async () => (now() - readAt > STALE_MS ? 'degraded' : 'ok');
  return { has: (jti: string) => ids.has(jti), refresh, check };
};

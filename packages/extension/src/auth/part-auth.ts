import { z } from 'zod';
import { type Log } from '../log/log.js';
import { formatIssues } from '../manifest/read-manifest.js';
import { type Env } from '../runtime/build-info.js';
import { createRevokedList, REVOKED_POLL_MS } from './revoked.js';
import { accessOfSecurity, scopeOf } from './token-check.js';
import { createTokenCheck, remoteKeys } from './verify-token.js';

const AuthEnvSchema = z.object({
  AGENTAGE_ISSUER: z.url(),
  AGENTAGE_AUDIENCE: z.string().min(1),
  AGENTAGE_ORIGIN: z.url(),
});

// *.agentage.io covers the domain and every host under it at any depth; else one exact host.
export const covers = (audience: string, host: string): boolean =>
  audience.startsWith('*.')
    ? host === audience.slice(2) || host.endsWith(audience.slice(1))
    : host === audience;

// The start rule: an api or mcp part with no issuer, or off its audience, does not start.
const settingsOf = (env: Env) => {
  const parsed = AuthEnvSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(`no token check, no start: ${formatIssues(parsed.error.issues)}`);
  const { AGENTAGE_ISSUER: issuer, AGENTAGE_AUDIENCE: audience } = parsed.data;
  const { origin, hostname } = new URL(parsed.data.AGENTAGE_ORIGIN);
  if (!covers(audience, hostname))
    throw new Error(`the host ${hostname} is not under the audience ${audience}`);
  return { issuer, audience, origin };
};

export const partAuth = (env: Env, id: string, log: Log) => {
  const { issuer, audience, origin } = settingsOf(env);
  const revoked = createRevokedList(issuer, log);
  void revoked.refresh();
  setInterval(() => void revoked.refresh(), REVOKED_POLL_MS).unref();
  const keys = remoteKeys(issuer);
  const resource = (scopes: string[]) => ({
    resource: origin,
    authorization_servers: [issuer],
    scopes_supported: scopes,
    bearer_methods_supported: ['header'],
  });
  const check = createTokenCheck({ issuer, audience, id, origin, keys, revoked });
  return { check, health: revoked.check, resource };
};

type Operation = { security?: unknown };

// What the routes (OpenAPI operations) and tools (record) declare, for scopes_supported.
export const declaredScopes = (
  id: string,
  openapi: Record<string, unknown> | null,
  tools: readonly { scope: string }[] = []
): string[] => {
  const items = Object.values((openapi?.['paths'] ?? {}) as Record<string, object>);
  const operations = items
    .flatMap((item) => Object.values(item))
    .filter((op) => !Array.isArray(op) && typeof op === 'object');
  const routes = operations.map((op: Operation) =>
    scopeOf(id, accessOfSecurity(op.security ?? openapi?.['security']))
  );
  const scopes = new Set([...routes, ...tools.map((tool) => tool.scope)]);
  return [...scopes].filter((scope) => scope !== 'public').sort();
};

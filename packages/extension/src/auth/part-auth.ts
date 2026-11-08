import { z } from 'zod';
import { OriginSchema } from '../discovery/discovery.schema.js';
import { messageOf, type Log } from '../log/log.js';
import { formatIssues } from '../manifest/read-manifest.js';
import { type Env } from '../runtime/build-info.js';
import { createRevokedList, REVOKED_POLL_MS } from './revoked.js';
import { accessOfSecurity, scopeOf } from './token-check.js';
import { createTokenCheck, remoteKeys } from './verify-token.js';

// *.{a domain of two labels or more}, or one host, as a deployment's origin may name it.
export const isAudience = (audience: string) => {
  const host = audience.startsWith('*.') ? audience.slice(2) : audience;
  return ['https', 'http'].some((scheme) => OriginSchema.safeParse(`${scheme}://${host}`).success);
};

const AuthEnvSchema = z.object({
  AGENTAGE_ISSUER: z
    .url()
    .refine((url) => URL.canParse(url) && new URL(url).origin === url, 'an origin, no path'),
  AGENTAGE_AUDIENCE: z.string().refine(isAudience, '*.{domain} or one host'),
  AGENTAGE_ORIGIN: z.url(),
});

// *.agentage.io covers the domain and every host under it at any depth; else one exact host.
export const covers = (audience: string, host: string): boolean =>
  audience.startsWith('*.')
    ? host === audience.slice(2) || host.endsWith(audience.slice(1))
    : host === audience;

const settingsOf = (env: Env) => {
  const parsed = AuthEnvSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(`no token check, no start: ${formatIssues(parsed.error.issues)}`);
  const { AGENTAGE_ISSUER: issuer, AGENTAGE_AUDIENCE: audience } = parsed.data;
  const { origin, hostname } = new URL(parsed.data.AGENTAGE_ORIGIN);
  if (!covers(audience, hostname))
    throw new Error(`the host ${hostname} is not under the audience ${audience}`);
  if (origin.startsWith('https:') && !issuer.startsWith('https:'))
    throw new Error(`the issuer ${issuer} is not https under the origin ${origin}`);
  return { issuer, audience, origin };
};

// Read before serving, then every 30 s (keys only while none held); no stop on a dead issuer.
export const partAuth = async (env: Env, id: string, log: Log, scopes: string[]) => {
  const { issuer, audience, origin } = settingsOf(env);
  const { keys, read, held } = remoteKeys(issuer);
  const revoked = createRevokedList(issuer, log);
  const unread = (err: unknown) => log.warn('key set not read', { reason: messageOf(err) });
  const poll = () => Promise.all([held() || read().catch(unread), revoked.refresh()]);
  await poll();
  setInterval(() => void poll(), REVOKED_POLL_MS).unref();
  return {
    tokenCheck: createTokenCheck({ issuer, audience, id, origin, keys, revoked }),
    resource: {
      resource: origin,
      authorization_servers: [issuer],
      scopes_supported: scopes,
      bearer_methods_supported: ['header'],
    },
    checks: { auth: async () => (held() ? revoked.check() : 'degraded') },
  };
};

export const declaredScopes = (
  id: string,
  openapi: Record<string, unknown> | null,
  tools: readonly { scope: string }[] = []
): string[] => {
  const routes = Object.values(openapi?.['paths'] ?? {})
    .flatMap((item: object) => Object.values(item))
    .filter((op): op is { security?: unknown } => typeof op === 'object' && !Array.isArray(op))
    .map((op) => scopeOf(id, accessOfSecurity(op.security ?? openapi?.['security'])));
  const scopes = new Set([...routes, ...tools.map((tool) => tool.scope)]);
  return [...scopes].filter((scope) => scope !== 'public').sort();
};

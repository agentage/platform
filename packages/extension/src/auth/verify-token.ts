import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { fail, isFailure } from '../envelope/envelope.js';
import { RANK, scopeOf, type Access, type TokenCheck } from './token-check.js';

export interface TokenCheckDeps {
  issuer: string;
  audience: string;
  id: string;
  origin: string;
  keys: JWTVerifyGetKey;
  revoked: { has(jti: string): boolean };
}

// Read at first use and again only for an unknown kid, so a known key outlives an issuer outage.
export const remoteKeys = (issuer: string): JWTVerifyGetKey =>
  createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    timeoutDuration: 3000,
    cacheMaxAge: Infinity,
  });

const VERIFY = { typ: 'at+jwt', algorithms: ['EdDSA'], requiredClaims: ['exp'] };
const ClaimsSchema = z.object({
  sub: z.string().min(1),
  scope: z.string(),
  jti: z.string().optional(),
});

const invalid = (origin: string, message = 'Invalid token') =>
  fail('UNAUTHORIZED', message, {
    headers: {
      'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  });

const forbidden = (scope: string) =>
  fail('FORBIDDEN', `Needs ${scope}`, {
    headers: { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"` },
  });

// A key set that cannot be read is an outage, never a 401; a kid it lacks is a bad token.
const keysOrOutage =
  (keys: JWTVerifyGetKey): JWTVerifyGetKey =>
  async (header, token) => {
    if (!header.kid) throw new errors.JWKSNoMatchingKey();
    try {
      return await keys(header, token);
    } catch (err) {
      if (err instanceof errors.JWKSNoMatchingKey) throw err;
      throw fail('UNAVAILABLE', 'Token keys unavailable', { retryAfter: 5 });
    }
  };

const claimsOf = async (authorization: string, deps: TokenCheckDeps) => {
  const jwt = /^Bearer aga_(\S+)$/.exec(authorization)?.[1] ?? '';
  const options = { ...VERIFY, issuer: deps.issuer, audience: deps.audience };
  const verified = await jwtVerify(jwt, deps.keys, options).catch((err: unknown) => {
    throw isFailure(err) ? err : invalid(deps.origin);
  });
  const claims = ClaimsSchema.safeParse(verified.payload);
  if (!claims.success) throw invalid(deps.origin);
  return claims.data;
};

const grants = (scope: string, id: string, access: Access): boolean =>
  scope.split(' ').some((held) => {
    const [owner, verb] = held.split(':');
    return owner === id && RANK[verb as Access] >= RANK[access];
  });

// C4: run in every part before part code; only an unknown kid makes it call the issuer.
export const createTokenCheck = (given: TokenCheckDeps): TokenCheck => {
  const deps = { ...given, keys: keysOrOutage(given.keys) };
  return async (authorization, access) => {
    if (access === 'public') return null;
    if (!authorization) throw invalid(deps.origin, 'Missing token');
    const { sub, scope, jti } = await claimsOf(authorization, deps);
    if (jti !== undefined && deps.revoked.has(jti)) throw invalid(deps.origin, 'Token revoked');
    if (!grants(scope, deps.id, access)) throw forbidden(scopeOf(deps.id, access));
    return { sub, scopes: scope.split(' ') };
  };
};

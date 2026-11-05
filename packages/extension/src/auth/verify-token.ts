import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { fail, isFailure } from '../envelope/envelope.js';
import { RANK, retryOnce, scopeOf, type Access, type TokenCheck } from './token-check.js';

export interface TokenCheckDeps {
  issuer: string;
  audience: string;
  id: string;
  origin: string;
  keys: JWTVerifyGetKey;
  revoked: { has(jti: string): boolean; loaded(): boolean };
}

const VERIFY = { algorithms: ['EdDSA'], requiredClaims: ['exp'] };
const ClaimsSchema = z.object({
  sub: z.string().min(1),
  aud: z.string(),
  scope: z.string(),
  jti: z.string().optional(),
});

const unavailable = (message: string) => fail('UNAVAILABLE', message, { retryAfter: 5 });

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

const outage = (err: unknown) => !(err instanceof errors.JWKSNoMatchingKey);

// A key set that cannot be read is an outage, never a 401; a kid it lacks is a bad token.
const keysOrOutage =
  (keys: JWTVerifyGetKey): JWTVerifyGetKey =>
  async (header, token) => {
    if (!header.kid) throw new errors.JWKSNoMatchingKey();
    return retryOnce(async () => keys(header, token), outage).catch((err: unknown) => {
      throw outage(err) ? unavailable('Token keys unavailable') : err;
    });
  };

// Read at start and again only for an unknown kid, so a known key outlives an issuer outage.
export const remoteKeys = (issuer: string) => {
  const set = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    timeoutDuration: 3000,
    cacheMaxAge: Infinity,
  });
  return { keys: keysOrOutage(set), read: () => retryOnce(set.reload) };
};

const claimsOf = async (authorization: string, deps: TokenCheckDeps) => {
  const [scheme = '', credential = '', ...rest] = authorization.split(' ');
  const bearer = scheme.toLowerCase() === 'bearer' && rest.length === 0;
  const jwt = bearer && credential.startsWith('aga_') ? credential : '';
  const options = { ...VERIFY, issuer: deps.issuer, audience: deps.audience };
  const verified = await jwtVerify(jwt.slice(4), deps.keys, options).catch((err: unknown) => {
    throw isFailure(err) ? err : invalid(deps.origin);
  });
  const claims = ClaimsSchema.safeParse(verified.payload);
  if (!claims.success || verified.protectedHeader.typ !== 'at+jwt') throw invalid(deps.origin);
  return claims.data;
};

const grants = (scope: string, id: string, access: Access): boolean => {
  const held = new Set(scope.split(' '));
  return (['read', 'write', 'admin'] as const).some(
    (verb) => RANK[verb] >= RANK[access] && held.has(`${id}:${verb}`)
  );
};

export const createTokenCheck =
  (deps: TokenCheckDeps): TokenCheck =>
  async (authorization, access) => {
    if (access === 'public') return null;
    if (!authorization) throw invalid(deps.origin, 'Missing token');
    const { sub, scope, jti } = await claimsOf(authorization, deps);
    if (jti !== undefined && !deps.revoked.loaded()) throw unavailable('Revoked list unavailable');
    if (jti !== undefined && deps.revoked.has(jti)) throw invalid(deps.origin, 'Token revoked');
    if (!grants(scope, deps.id, access)) throw forbidden(scopeOf(deps.id, access));
    return { sub, scopes: scope.split(' ') };
  };

import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';

export const DEV_ISSUER = 'http://localhost:4281';
export const DEV_AUDIENCE = '*.agentage.io';

const TokenRequestSchema = z.strictObject({
  scope: z
    .string()
    .max(512)
    .regex(/^[a-z][a-z0-9-]*:(read|write|admin)( [a-z][a-z0-9-]*:(read|write|admin))*$/),
  sub: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  ttlSeconds: z.int().min(60).max(86_400).optional(),
});

interface Keys {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

export const newKeys = (): Keys => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const kid = `dev-${randomUUID().slice(0, 8)}`;
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' },
  };
};

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

// The api-standards token shape: aga_<jwt>, typ at+jwt, EdDSA, scope {id}:{verb}, a jti.
export const mint = (keys: Keys, request: z.infer<typeof TokenRequestSchema>, now = Date.now()) => {
  const iat = Math.floor(now / 1000);
  const exp = iat + (request.ttlSeconds ?? 3600);
  const claims = {
    iss: DEV_ISSUER,
    sub: request.sub ?? 'usr_dev',
    aud: DEV_AUDIENCE,
    scope: request.scope,
    iat,
    exp,
    jti: `tok_${randomUUID()}`,
  };
  const input = `${b64({ alg: 'EdDSA', typ: 'at+jwt', kid: keys.kid })}.${b64(claims)}`;
  const signature = sign(null, Buffer.from(input), keys.privateKey).toString('base64url');
  return { token: `aga_${input}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
};

const reply = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  if (text.length > 4096) throw new Error('body too large');
  return JSON.parse(text || '{}') as unknown;
};

const tokenRoute = async (keys: Keys, req: IncomingMessage, res: ServerResponse) => {
  const parsed = TokenRequestSchema.safeParse(await readBody(req).catch(() => null));
  if (!parsed.success)
    return reply(res, 400, { error: 'scope must be {id}:{read|write|admin}, space-separated' });
  reply(res, 200, mint(keys, parsed.data));
};

// Mints only: the kit does not verify tokens yet. Never part of a deployed estate.
export const createIssuer = (keys: Keys = newKeys()): Server =>
  createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'OPTIONS') return reply(res, 204, undefined);
    if (req.method === 'GET' && path === '/health') return reply(res, 200, { status: 'ok' });
    if (req.method === 'GET' && path === '/.well-known/jwks.json')
      return reply(res, 200, { keys: [keys.jwk] });
    if (req.method === 'POST' && path === '/token') return void tokenRoute(keys, req, res);
    reply(res, 404, { error: 'not found' });
  });

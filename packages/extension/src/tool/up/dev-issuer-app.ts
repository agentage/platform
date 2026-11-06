import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { GATEWAY_PORT, PART_PORT } from './gateway.js';

// Where the host reaches the dev issuer; the parts of `up` reach it, and tokens name it, by service.
export const DEV_ISSUER = 'http://localhost:4281';
export const UP_ISSUER = `http://issuer:${PART_PORT}`;
// The host of `up` (http://localhost:4280): the one host this audience covers.
export const DEV_AUDIENCE = 'localhost';

export type IssuerSettings = { issuer: string; audience: string };

const TokenRequestSchema = z.strictObject({
  scope: z
    .string()
    .max(512)
    .regex(/^[a-z][a-z0-9-]*:(read|write|admin)( [a-z][a-z0-9-]*:(read|write|admin))*$/),
  sub: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  ttlSeconds: z.int().min(1).max(86_400).optional(),
  aud: z.string().min(1).max(253).optional(),
});

const RevokeSchema = z.strictObject({ jti: z.string().regex(/^tok_[0-9a-f-]{36}$/) });

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
export const mint = (
  keys: Keys,
  request: z.infer<typeof TokenRequestSchema>,
  settings: IssuerSettings,
  now = Date.now()
) => {
  const iat = Math.floor(now / 1000);
  const exp = iat + (request.ttlSeconds ?? 3600);
  const { scope, sub = 'usr_dev', aud = settings.audience } = request;
  const claims = { iss: settings.issuer, sub, aud, scope, iat, exp, jti: `tok_${randomUUID()}` };
  const input = `${b64({ alg: 'EdDSA', typ: 'at+jwt', kid: keys.kid })}.${b64(claims)}`;
  const signature = sign(null, Buffer.from(input), keys.privateKey).toString('base64url');
  return { token: `aga_${input}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
};

const reply = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-client-type',
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

type Issuer = { settings: IssuerSettings; keys: Keys; revoked: Map<string, number> };

const tokenRoute = async (issuer: Issuer, req: IncomingMessage, res: ServerResponse) => {
  const parsed = TokenRequestSchema.safeParse(await readBody(req).catch(() => null));
  if (!parsed.success)
    return reply(res, 400, { error: 'scope must be {id}:{read|write|admin}, space-separated' });
  reply(res, 200, mint(issuer.keys, parsed.data, issuer.settings));
};

// Kept for a day, the longest a dev token lives, so an entry never outlasts its token by more.
const revokeRoute = async (issuer: Issuer, req: IncomingMessage, res: ServerResponse) => {
  const parsed = RevokeSchema.safeParse(await readBody(req).catch(() => null));
  if (!parsed.success) return reply(res, 400, { error: 'jti must be a tok_ id' });
  issuer.revoked.set(parsed.data.jti, Math.floor(Date.now() / 1000) + 86_400);
  reply(res, 200, { jti: parsed.data.jti, revoked: true });
};

const revokedList = ({ revoked }: Issuer) => {
  const now = Date.now() / 1000;
  const live = [...revoked].filter(([, exp]) => exp > now).map(([jti, exp]) => ({ jti, exp }));
  return { revoked: live, generatedAt: new Date().toISOString() };
};

// security.md, local daemons: its tokens open the parts of `up`, so no other site may mint one.
const ORIGINS = ['localhost', '127.0.0.1'].map((host) => `http://${host}:${GATEWAY_PORT}`);
const allowed = ({ settings }: Issuer, req: IncomingMessage) => {
  const host = (req.headers.host ?? '').replace(/:[0-9]+$/, '');
  const hosts = ['localhost', '127.0.0.1', new URL(settings.issuer).hostname];
  return hosts.includes(host) && [undefined, ...ORIGINS].includes(req.headers.origin);
};

const route = (issuer: Issuer, req: IncomingMessage, res: ServerResponse) => {
  const at = `${req.method ?? ''} ${(req.url ?? '/').split('?')[0] ?? ''}`;
  if (!allowed(issuer, req)) return reply(res, 403, { error: 'host or origin not allowed' });
  if (req.method === 'OPTIONS') return reply(res, 204, undefined);
  if (at === 'GET /health') return reply(res, 200, { status: 'ok' });
  if (at === 'GET /.well-known/jwks.json') return reply(res, 200, { keys: [issuer.keys.jwk] });
  if (at === 'GET /.well-known/agentage-revoked') return reply(res, 200, revokedList(issuer));
  if (at === 'POST /token') return void tokenRoute(issuer, req, res);
  if (at === 'POST /revoke') return void revokeRoute(issuer, req, res);
  reply(res, 404, { error: 'not found' });
};

export const createIssuer = (
  settings: IssuerSettings = { issuer: UP_ISSUER, audience: DEV_AUDIENCE },
  keys: Keys = newKeys()
): Server => {
  const issuer = { settings, keys, revoked: new Map<string, number>() };
  return createServer((req, res) => route(issuer, req, res));
};

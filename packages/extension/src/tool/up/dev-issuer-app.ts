import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';

// Where the host reaches the dev issuer; inside `up` the parts and the tokens name it by service.
export const DEV_ISSUER = 'http://localhost:4281';
// The host of `up` (http://localhost:4280): the one host this audience covers.
export const DEV_AUDIENCE = 'localhost';

export interface IssuerSettings {
  issuer: string;
  audience: string;
}

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
  const jti = `tok_${randomUUID()}`;
  const claims = { iss: settings.issuer, sub, aud, scope, iat, exp, jti };
  const input = `${b64({ alg: 'EdDSA', typ: 'at+jwt', kid: keys.kid })}.${b64(claims)}`;
  const signature = sign(null, Buffer.from(input), keys.privateKey).toString('base64url');
  const token = `aga_${input}.${signature}`;
  return { token, jti, exp, expiresAt: new Date(exp * 1000).toISOString() };
};

const reply = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
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

// jti to exp of every token minted, and of the revoked ones.
const issuerOf = (settings: IssuerSettings, keys: Keys) => ({
  settings,
  keys,
  minted: new Map<string, number>(),
  revoked: new Map<string, number>(),
});

type Issuer = ReturnType<typeof issuerOf>;

const tokenRoute = async (issuer: Issuer, req: IncomingMessage, res: ServerResponse) => {
  const parsed = TokenRequestSchema.safeParse(await readBody(req).catch(() => null));
  if (!parsed.success)
    return reply(res, 400, { error: 'scope must be {id}:{read|write|admin}, space-separated' });
  const { token, jti, exp, expiresAt } = mint(issuer.keys, parsed.data, issuer.settings);
  issuer.minted.set(jti, exp);
  reply(res, 200, { token, expiresAt });
};

const revokeRoute = async (issuer: Issuer, req: IncomingMessage, res: ServerResponse) => {
  const parsed = RevokeSchema.safeParse(await readBody(req).catch(() => null));
  if (!parsed.success) return reply(res, 400, { error: 'jti must be a tok_ id' });
  const { jti } = parsed.data;
  const exp = issuer.minted.get(jti);
  if (exp === undefined) return reply(res, 404, { error: 'unknown jti' });
  issuer.revoked.set(jti, exp);
  reply(res, 200, { jti, revoked: true });
};

// The C3 body: an entry leaves the list once its token has expired.
const revokedList = ({ revoked }: Issuer) => {
  const now = Date.now() / 1000;
  const live = [...revoked].filter(([, exp]) => exp > now).map(([jti, exp]) => ({ jti, exp }));
  return { revoked: live, generatedAt: new Date().toISOString() };
};

const route = (issuer: Issuer, req: IncomingMessage, res: ServerResponse) => {
  const at = `${req.method ?? ''} ${(req.url ?? '/').split('?')[0] ?? ''}`;
  if (req.method === 'OPTIONS') return reply(res, 204, undefined);
  if (at === 'GET /health') return reply(res, 200, { status: 'ok' });
  if (at === 'GET /.well-known/jwks.json') return reply(res, 200, { keys: [issuer.keys.jwk] });
  if (at === 'GET /.well-known/agentage-revoked') return reply(res, 200, revokedList(issuer));
  if (at === 'POST /token') return void tokenRoute(issuer, req, res);
  if (at === 'POST /revoke') return void revokeRoute(issuer, req, res);
  reply(res, 404, { error: 'not found' });
};

// The issuer of `up` (C9), trusted only by its parts; never part of a deployed estate.
export const createIssuer = (
  settings: IssuerSettings = { issuer: DEV_ISSUER, audience: DEV_AUDIENCE },
  keys: Keys = newKeys()
): Server => {
  const issuer = issuerOf(settings, keys);
  return createServer((req, res) => route(issuer, req, res));
};

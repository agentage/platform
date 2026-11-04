import { createPublicKey, verify, type JsonWebKeyInput } from 'node:crypto';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIssuer, DEV_AUDIENCE, DEV_ISSUER } from './dev-issuer-app.js';
import { token } from './token.js';

let issuer: Server;
let url: string;
beforeEach(async () => {
  issuer = createIssuer();
  await new Promise<void>((resolve) => issuer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;
});
afterEach(() => void issuer.close());

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>;

describe('token', () => {
  it('mints an aga_ EdDSA at+jwt with the scope and a jti, signed by the JWKS key', async () => {
    const minted = await token({ scope: 'probe:read probe:write', issuer: url });
    expect(minted.startsWith('aga_')).toBe(true);
    const [header = '', claims = '', signature = ''] = minted.slice(4).split('.');
    const head = decode(header);
    expect(head).toMatchObject({ alg: 'EdDSA', typ: 'at+jwt' });
    const body = decode(claims);
    expect(body).toMatchObject({
      iss: DEV_ISSUER,
      aud: DEV_AUDIENCE,
      sub: 'usr_dev',
      scope: 'probe:read probe:write',
    });
    expect(body['jti']).toMatch(/^tok_[0-9a-f-]{36}$/);
    expect(Number(body['exp']) - Number(body['iat'])).toBe(3600);
    const jwks = (await (await fetch(`${url}/.well-known/jwks.json`)).json()) as {
      keys: (JsonWebKeyInput['key'] & { kid?: string })[];
    };
    const jwk = jwks.keys.find((key) => key.kid === head['kid']);
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
    const key = createPublicKey({ key: jwk as JsonWebKeyInput['key'], format: 'jwk' });
    const input = Buffer.from(`${header}.${claims}`);
    expect(verify(null, input, key, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(verify(null, Buffer.from(`${header}.x`), key, Buffer.from(signature, 'base64url'))).toBe(
      false
    );
  });

  it('refuses a scope that is not {id}:{read|write|admin}', async () => {
    for (const scope of ['probe', 'probe:delete', 'Probe:read', 'probe:read  probe:write']) {
      await expect(token({ scope, issuer: url })).rejects.toThrow(
        /^the dev issuer refused: \{"error":"scope must be/
      );
    }
  });

  it('says to run up when no issuer answers, and refuses an answer without a token', async () => {
    await expect(token({ scope: 'probe:read', issuer: 'http://127.0.0.1:1' })).rejects.toThrow(
      'no dev issuer at http://127.0.0.1:1: run agentage extension up first'
    );
    const fake = (async () => new Response('{"token":"jwt"}')) as typeof fetch;
    await expect(token({ scope: 'probe:read', fetch: fake })).rejects.toThrow();
    const html = (async () => new Response('<html>', { status: 502 })) as typeof fetch;
    await expect(token({ scope: 'probe:read', fetch: html })).rejects.toThrow(
      'the dev issuer refused: null'
    );
  });
});

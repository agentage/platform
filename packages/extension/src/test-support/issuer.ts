import { type AddressInfo } from 'node:net';
import { createIssuer, newKeys, type IssuerSettings } from '../tool/up/dev-issuer-app.js';

export const AUDIENCE = '*.agentage.io';
export const ORIGIN = 'https://probe.next.agentage.io';

export interface TestIssuer {
  url: string;
  keys: ReturnType<typeof newKeys>;
  settings: IssuerSettings;
  bearer(body: Record<string, unknown>): Promise<string>;
  revoke(jti: string): Promise<Response>;
  close(): Promise<void>;
}

const post = (url: string, body: object) =>
  fetch(url, { method: 'POST', body: JSON.stringify(body) });

// The dev issuer of `up` on 127.0.0.1, naming itself by the URL it listens on.
export const startIssuer = async (audience = AUDIENCE): Promise<TestIssuer> => {
  const settings: IssuerSettings = { issuer: '', audience };
  const keys = newKeys();
  const server = createIssuer(settings, keys);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  settings.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: settings.issuer,
    keys,
    settings,
    bearer: async (body) => {
      const { token } = (await (await post(`${settings.issuer}/token`, body)).json()) as {
        token: string;
      };
      return `Bearer ${token}`;
    },
    revoke: (jti) => post(`${settings.issuer}/revoke`, { jti }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

export const claimsOf = (bearer: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(bearer.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;

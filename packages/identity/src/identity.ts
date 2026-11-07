import { authCalls, type FetchLike, type MintedPat } from './auth.js';

export type TokenSource = () => Promise<string | undefined>;
export type Identity = ReturnType<typeof createIdentity>;
export interface IdentityOptions {
  authUrl: string;
  audience: string;
  scopes?: string[];
  fetch?: FetchLike;
  location?: Pick<Location, 'href' | 'assign'>;
}

// A token this close to its expiry is minted again, so a call never carries a dying one.
const SKEW_MS = 60_000;

// The PAT lives in page memory only: one mint in flight, again once it expires.
const tokenCache = (renew: () => Promise<MintedPat | undefined>) => {
  let pat: MintedPat | undefined;
  let minting: Promise<MintedPat | undefined> | undefined;
  const current: TokenSource = async () => {
    if (!pat || Date.parse(pat.expiresAt) - SKEW_MS <= Date.now()) {
      minting ??= renew().finally(() => (minting = undefined));
      pat = await minting;
    }
    return pat?.token;
  };
  const release = async (revoke: (id: string) => Promise<unknown>) => {
    const held = pat;
    pat = undefined;
    if (held) await revoke(held.id);
  };
  return { current, release };
};

export const createIdentity = (options: IdentityOptions) => {
  const authUrl = options.authUrl.replace(/\/+$/, '');
  const auth = authCalls(authUrl, options.fetch ?? ((url, init) => fetch(url, init)));
  const { scopes, audience } = options;
  const body = { format: 'jwt', label: 'browser', expiresInDays: 1, scopes, audience };
  const cache = tokenCache(async () => ((await auth.account()) ? auth.mint(body) : undefined));
  // Signed in: resolves now. Else the page leaves for auth's sign-in and comes back to `next`.
  const signIn = async () => {
    const signedIn = await auth.account();
    if (signedIn) return signedIn;
    const page = options.location ?? globalThis.location;
    page.assign(`${authUrl}/sign-in?next=${encodeURIComponent(page.href)}`);
    return new Promise<never>(() => undefined);
  };
  const signOut = async () => {
    await cache.release(auth.revoke);
    await auth.end();
  };
  return { account: auth.account, signIn, token: () => cache.current, tokens: auth.list, signOut };
};

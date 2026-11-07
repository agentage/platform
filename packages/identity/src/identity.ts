import { authCalls, type FetchLike, type MintedPat } from './auth.js';

export type TokenSource = () => Promise<string | undefined>;
export type Identity = ReturnType<typeof createIdentity>;
type Nav = Pick<Location, 'href' | 'assign'>;
export interface IdentityOptions {
  authUrl: string;
  audience: string;
  scopes?: string[];
  fetch?: FetchLike;
  location?: Nav;
}

// A token this close to its expiry is minted again, so a call never carries a dying one.
const SKEW_MS = 60_000;
const DAY_MS = 86_400_000;

// From the local mint time, so a client clock off from auth's cannot force a mint per call.
const deadline = (pat: MintedPat, startedAt: number) => {
  const life = Date.parse(pat.expiresAt) - startedAt;
  return startedAt + (life > SKEW_MS ? Math.min(life, DAY_MS) : DAY_MS) - SKEW_MS;
};

// The PAT lives in page memory only: one mint in flight, again once it expires.
const tokenCache = (renew: () => Promise<MintedPat | undefined>) => {
  let held: { pat: MintedPat; until: number } | undefined;
  let minting: Promise<void> | undefined;
  const mint = async () => {
    const startedAt = Date.now();
    const pat = await renew();
    held = pat && { pat, until: deadline(pat, startedAt) };
  };
  const current: TokenSource = async () => {
    if (!held || held.until <= Date.now())
      await (minting ??= mint().finally(() => (minting = undefined)));
    return held?.pat.token;
  };
  // A mint in flight lands first, so its PAT is revoked too.
  const release = async (revoke: (id: string) => Promise<unknown>) => {
    await minting?.catch(() => undefined);
    const last = held;
    held = undefined;
    if (last) await revoke(last.pat.id);
  };
  return { current, release };
};

type Auth = ReturnType<typeof authCalls>;

// Signed in: resolves now. Else the page leaves for auth's sign-in and comes back to `next`.
const signIn = async (auth: Auth, authUrl: string, nav?: Nav) => {
  const signedIn = await auth.account();
  if (signedIn) return signedIn;
  const page = nav ?? globalThis.location;
  page.assign(`${authUrl}/sign-in?next=${encodeURIComponent(page.href)}`);
  return new Promise<never>(() => undefined);
};

// The session ends even when the revoke fails; the failure still reaches the caller.
const signOut = async (auth: Auth, cache: ReturnType<typeof tokenCache>) => {
  try {
    await cache.release(auth.revoke);
  } finally {
    await auth.end();
  }
};

export const createIdentity = (options: IdentityOptions) => {
  const authUrl = options.authUrl.replace(/\/+$/, '');
  const auth = authCalls(authUrl, options.fetch ?? ((url, init) => fetch(url, init)));
  const { scopes, audience } = options;
  const body = { format: 'jwt', label: 'browser', expiresInDays: 1, scopes, audience };
  const cache = tokenCache(async () => ((await auth.account()) ? auth.mint(body) : undefined));
  return {
    account: auth.account,
    signIn: () => signIn(auth, authUrl, options.location),
    token: () => cache.current,
    tokens: auth.list,
    signOut: () => signOut(auth, cache),
  };
};

import { authCalls, type FetchLike, type MintedPat } from './auth.js';

export type TokenSource = () => Promise<string | undefined>;
export type Identity = ReturnType<typeof createIdentity>;
type Nav = Pick<Location, 'href' | 'assign'>;
export interface IdentityOptions {
  authUrl: string;
  scopes: string[];
  fetch?: FetchLike;
  location?: Nav;
}

// A token this close to its expiry is minted again, so a call never carries a dying one.
const SKEW_MS = 60_000;
// The browser token's label and lifetime; the shell token replaces them.
const BROWSER = { format: 'jwt', label: 'browser', expiresInDays: 1 } as const;
const DAY_MS = BROWSER.expiresInDays * 86_400_000;

// Late-binds the global, so a fetch patched after createIdentity is still the one called.
const globalFetch: FetchLike = (url, init) => fetch(url, init);

// From the local mint time, so a client clock off from auth's cannot force a mint per call.
const deadline = (pat: MintedPat, startedAt: number) => {
  const life = Date.parse(pat.expiresAt) - startedAt;
  const trusted = life > SKEW_MS ? Math.min(life, DAY_MS) : DAY_MS;
  return startedAt + trusted - SKEW_MS;
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

export interface MintOptions {
  label: string;
  scopes: string[];
  expiresInDays: number;
}

export const createIdentity = (options: IdentityOptions) => {
  const authUrl = options.authUrl.replace(/\/+$/, '');
  const auth = authCalls(authUrl, options.fetch ?? globalFetch);
  const body = { ...BROWSER, scopes: options.scopes };
  const cache = tokenCache(async () => ((await auth.account()) ? auth.mint(body) : undefined));
  return {
    account: auth.account,
    signIn: () => signIn(auth, authUrl, options.location),
    token: () => cache.current,
    tokens: auth.list,
    mintToken: (mint: MintOptions) => auth.mint({ format: 'jwt', ...mint }),
    revokeToken: async (id: string) => void (await auth.revoke(id)),
    signOut: () => signOut(auth, cache),
  };
};

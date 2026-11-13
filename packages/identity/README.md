# @agentage/identity

The identity client for an agentage browser page: sign in at auth, a one-hour token for the
parts, sign out. It runs in the page and talks to auth with credentialed requests.

```ts
import { createIdentity } from '@agentage/identity';

const id = createIdentity({
  authUrl: 'https://auth.agentage.io',
  scopes: ['probe:read'],
});

await id.signIn(); // auth's sign-in page, then back to this page
const token = id.token(); // a TokenSource for createBridge({ token })
await id.signOut(); // revokes the token, then ends the session
```

- `signIn()` resolves with the account when a session exists. Without one, the page goes to
  `<authUrl>/sign-in?next=<this page>` and comes back after sign-in; call `signIn()` again on load.
- `token()` returns `() => Promise<string | undefined>`. The first call mints a one-hour PAT (`expiresInMinutes: 60`)
  (`POST /account/pat`, `format: 'jwt'`, label `browser`); it stays in page memory only and is
  minted again 60 s before it expires. Without a session it gives `undefined`.
- `signOut()` deletes that PAT (`DELETE /account/pat/{id}`; the parts refuse it within 60 s),
  then ends the auth session.
- `account()` is the signed-in account or `null`; `tokens()` lists the account's PATs.
- `mintToken({ label, scopes, expiresInDays })` mints a PAT of that label, scopes and lifetime
  (1-730 days) and resolves `{ id, token, expiresAt }`; the token is shown once.
  `revokeToken(id)` revokes one (`DELETE /account/pat/{id}`).

Two options are for tests and embedders: `fetch` (a `fetch`-shaped function; the global `fetch` is
used, read at call time, when left out) and `location` (`{ href, assign }`; `window.location` when
left out) that `signIn()` navigates.

`scopes` is required: auth mints no PAT without one. Auth sets the token's audience itself. A
failed call throws an `IdentityError` with `code`, `message` and the HTTP `status`. The client
never logs a token.

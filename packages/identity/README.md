# @agentage/identity

The identity client for an agentage browser page: sign in at auth, a one-day token for the
parts, sign out. It runs in the page and talks to auth with credentialed requests.

```ts
import { createIdentity } from '@agentage/identity';

const id = createIdentity({
  authUrl: 'https://auth.agentage.io',
  audience: 'next.agentage.io',
  scopes: ['probe:read'],
});

await id.signIn(); // auth's sign-in page, then back to this page
const token = id.token(); // a TokenSource for createBridge({ token })
await id.signOut(); // revokes the token, then ends the session
```

- `signIn()` resolves with the account when a session exists. Without one, the page goes to
  `<authUrl>/sign-in?next=<this page>` and comes back after sign-in; call `signIn()` again on load.
- `token()` returns `() => Promise<string | undefined>`. The first call mints a one-day PAT
  (`POST /account/pat`, `format: 'jwt'`, label `browser`); it stays in page memory only and is
  minted again after it expires. Without a session it gives `undefined`.
- `signOut()` deletes that PAT (`DELETE /account/pat/{id}`; the parts refuse it within 60 s),
  then ends the auth session.
- `account()` is the signed-in account or `null`; `tokens()` lists the account's PATs.

Auth needs at least one scope to mint, so pass `scopes`. `audience` is sent with the mint; auth
derives the audience itself today. A failed call throws an `IdentityError` with `code`,
`message` and the HTTP `status`. The client never logs a token.

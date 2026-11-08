import { scopeOf, type Caller, type TokenCheck } from '../auth/token-check.js';
import { grants } from '../auth/verify-token.js';
import { fail } from '../envelope/envelope.js';

// As if every request carried caller's token (none when null): scopes enforced, no issuer.
export const callerCheck =
  (id: string, caller: Caller | null): TokenCheck =>
  async (_authorization, access) => {
    if (access === 'public' || (access === 'optional' && !caller)) return null;
    if (!caller) throw fail('UNAUTHORIZED', 'Missing token');
    if (!grants(caller.scopes.join(' '), id, access))
      throw fail('FORBIDDEN', `Needs ${scopeOf(id, access)}`);
    return caller;
  };

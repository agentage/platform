import * as z from 'zod/mini';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type IdentityError = Error & { code: string; status: number };

export const ok = <T extends z.ZodMiniType>(data: T) =>
  z.object({ success: z.literal(true), data });
export const str = z.string();
export const Failed = z.object({ error: z.object({ code: str, message: str }) });
export const User = z.object({ id: str, email: str, name: z.optional(z.nullable(str)) });
export const Minted = ok(z.object({ id: str, token: str, expiresAt: str }));
const Times = { createdAt: z.nullable(str), expiresAt: z.nullable(str) };
export const Revoked = ok(z.object({ revoked: z.literal(true) }));
export const Summary = z.object({ id: str, label: str, scopes: z.array(str), ...Times });

export type Account = z.infer<typeof User>;
export type MintedPat = z.infer<typeof Minted>['data'];
export type TokenSummary = z.infer<typeof Summary>;

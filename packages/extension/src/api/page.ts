import { z } from 'zod';
import { reply, type Reply } from '../envelope/envelope.js';

// api-standards section 3: default 50, a limit above 200 is clamped, not refused.
export const MAX_LIMIT = 200;

const encode = (id: string): string => Buffer.from(id).toString('base64url');

// The cursor is the last row's id, opaque on the wire; parsed back to that id here.
const CursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/)
  .transform((cursor, ctx) => {
    const id = Buffer.from(cursor, 'base64url').toString();
    if (id && encode(id) === cursor) return id;
    ctx.issues.push({ code: 'custom', message: 'Invalid cursor', input: cursor });
    return z.NEVER;
  });

export const PageQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(50)
    .describe(`page size; a limit above ${MAX_LIMIT} is clamped to ${MAX_LIMIT}`)
    .transform((limit) => Math.min(limit, MAX_LIMIT)),
});

export interface Pagination {
  limit: number;
  nextCursor?: string;
}

// rows: up to limit + 1 read after the cursor; the extra row says a next page exists.
export const pageOf = <T extends { id: string | number }>(
  rows: readonly T[],
  limit: number
): Reply<T[]> => {
  const items = rows.slice(0, limit);
  const last = rows.length > limit ? items.at(-1) : undefined;
  const pagination: Pagination = { limit, ...(last && { nextCursor: encode(String(last.id)) }) };
  return reply(items, { meta: { pagination } });
};

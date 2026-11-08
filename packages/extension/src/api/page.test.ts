import { describe, expect, it } from 'vitest';
import { ok } from '../envelope/envelope.js';
import { startTestServer } from '../testing/test-server.js';
import { pageOf, PageQuerySchema } from './page.js';
import { type ApiContext } from './routes.js';

const ROWS = [{ id: 3 }, { id: 2 }, { id: 1 }];

describe('PageQuerySchema', () => {
  it('defaults the limit to 50, clamps it to 200, decodes the cursor to the id', () => {
    expect(PageQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(PageQuerySchema.parse({ limit: '900' })).toEqual({ limit: 200 });
    const { nextCursor } = pageOf(ROWS, 1).meta?.['pagination'] as { nextCursor: string };
    expect(PageQuerySchema.parse({ cursor: nextCursor, limit: '1' })).toEqual({
      cursor: '3',
      limit: 1,
    });
  });

  it('refuses a cursor it did not write and a limit below 1', () => {
    expect(PageQuerySchema.safeParse({ cursor: 'Mw' + 'x' }).success).toBe(false);
    expect(PageQuerySchema.safeParse({ cursor: 'a b' }).success).toBe(false);
    expect(PageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('pageOf', () => {
  it('answers the page in the envelope, nextCursor only when a row is left over', async () => {
    const create = ({ route }: ApiContext) => {
      route('get', '/rows', { summary: 'Rows', input: PageQuerySchema }, ({ input }) =>
        pageOf(ROWS, input.limit)
      );
    };
    const server = await startTestServer({ create });
    expect(await (await server.fetch('/api/v1/rows?limit=2')).json()).toEqual(
      ok([{ id: 3 }, { id: 2 }], { pagination: { limit: 2, nextCursor: 'Mg' } })
    );
    expect(await (await server.fetch('/api/v1/rows')).json()).toEqual(
      ok(ROWS, { pagination: { limit: 50 } })
    );
    await server.close();
  });
});

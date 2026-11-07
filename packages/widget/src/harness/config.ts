import * as z from 'zod/mini';
import { ExtensionIdSchema, WidgetNameSchema } from '../register/names.js';

const QuerySchema = z.object({
  widget: z.optional(WidgetNameSchema),
  token: z.optional(z.string().check(z.minLength(1), z.maxLength(4096))),
  scope: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9:_ -]{0,255}$/))),
  theme: z.optional(z.enum(['light', 'dark'])),
});

const PageSchema = z.object({
  id: ExtensionIdSchema,
  version: z.string().check(z.minLength(1), z.maxLength(64)),
});

export interface HarnessConfig {
  id: string;
  version: string;
  widget?: string;
  token?: string;
  scope?: string;
  theme?: 'light' | 'dark';
}

const meta = (doc: Document, name: string): string | undefined =>
  doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

const queryValue = (params: URLSearchParams, key: string): string | undefined =>
  params.get(key) ?? undefined;

export const readConfig = (doc: Document, search: string): HarnessConfig => {
  const page = PageSchema.parse({
    id: meta(doc, 'agentage-extension'),
    version: meta(doc, 'agentage-version'),
  });
  const params = new URLSearchParams(search);
  const query = QuerySchema.parse({
    widget: queryValue(params, 'widget'),
    token: queryValue(params, 'token'),
    scope: queryValue(params, 'scope'),
    theme: queryValue(params, 'theme'),
  });
  return { ...page, ...query };
};

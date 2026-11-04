import { type PartContext } from '../context/context.js';

export type PagesContext = PartContext;

// The kit 0.2 pages part: create(ctx) returns path -> HTML; Next.js pages arrive in a later kit.
export type PagesSite = Readonly<Record<string, string>>;

const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE =
  'body{font:16px/1.5 system-ui,sans-serif;margin:3rem;color:#1d1d1f;background:#fff}' +
  '@media (prefers-color-scheme:dark){body{color:#f5f5f7;background:#111}}code{font-size:.9em}';

// One static page that names what runs: "{id} {version} · {commit}".
export const versionPage = (ctx: PagesContext): string => {
  const { id, version, commit } = ctx.extension;
  const title = escape(id);
  return [
    '<!doctype html>',
    `<html lang="en"><head><meta charset="utf-8"><title>${title}</title>`,
    `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head>`,
    `<body><main><h1>${title}</h1><p>${title} ${escape(version)} · <code>${escape(commit)}</code></p></main></body></html>`,
    '',
  ].join('\n');
};

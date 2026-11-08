import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type PagesEntry, type PagesSite } from './pages.js';
import { isText, typeOf } from './types.js';

export interface SiteFromDirOptions {
  // The deployment's origin: its host replaces the placeholder in text files.
  origin: string;
  placeholder?: string;
  // Request path -> content type, for files without an extension (an /opengraph-image).
  types?: Record<string, string>;
}

const SITE_PLACEHOLDER = 'site-fqdn.sentinel.invalid';

// index.html is /, a/index.html and a.html are /a; every other file keeps its path.
const pathOf = (file: string): string =>
  `/${file.split(sep).join('/')}`.replace(/\/index\.html$|\.html$/, '') || '/';

const escaped = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const entryOf = (bytes: Buffer, type: string, own: boolean, rewrite: RegExp, host: string) => {
  const body = isText(type) ? bytes.toString('utf8').replace(rewrite, host) : bytes;
  return own ? { type, body } : body;
};

// A static export (Next.js out/) as a pages site: text with the placeholder host rewritten, the rest as bytes.
export const siteFromDir = (dir: string, opts: SiteFromDirOptions): PagesSite => {
  const host = new URL(opts.origin).host;
  const rewrite = new RegExp(escaped(opts.placeholder ?? SITE_PLACEHOLDER), 'gi');
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) =>
    e.isFile()
  );
  const site: Record<string, PagesEntry> = {};
  for (const file of files) {
    const path = pathOf(relative(dir, join(file.parentPath, file.name)));
    const own = opts.types?.[path];
    const bytes = readFileSync(join(file.parentPath, file.name));
    site[path] = entryOf(bytes, own ?? typeOf(path), own !== undefined, rewrite, host);
  }
  return site;
};

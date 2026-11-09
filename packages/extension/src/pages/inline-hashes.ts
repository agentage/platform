import { createHash } from 'node:crypto';
import { type PagesSite } from './pages.js';
import { typeOf } from './types.js';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const EXECUTES =
  /\btype\s*=\s*["']?(module|text\/javascript|application\/javascript)\b|^((?!\btype\s*=).)*$/is;

const sha256 = (text: string): string =>
  `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

// CSP hashes of the inline scripts an HTML page runs, so script-src never needs 'unsafe-inline'.
export const inlineScriptHashes = (html: string): string[] => {
  const hashes = new Set<string>();
  for (const [, attrs = '', body = ''] of html.matchAll(SCRIPT))
    if (body.trim() !== '' && !/\bsrc\s*=/i.test(attrs) && EXECUTES.test(attrs))
      hashes.add(sha256(body));
  return [...hashes];
};

// Path -> hashes, for the HTML entries that have inline scripts.
export const siteScriptHashes = (site: PagesSite): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const [path, entry] of Object.entries(site)) {
    const { type = typeOf(path), body = entry } =
      typeof entry === 'object' && 'type' in entry ? entry : {};
    if (!type.startsWith('text/html') || typeof body !== 'string') continue;
    const hashes = inlineScriptHashes(body);
    if (hashes.length > 0) found.set(path, hashes);
  }
  return found;
};

import { extname } from 'node:path';

// Content type by extension; a path without a known one is HTML.
const TEXT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

export const TYPES: Readonly<Record<string, string>> = {
  ...TEXT_TYPES,
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

// A text type is read as a string; every other type as bytes.
export const isText = (type: string): boolean => Object.values(TEXT_TYPES).includes(type);

export const typeOf = (path: string): string => TYPES[extname(path)] ?? 'text/html';

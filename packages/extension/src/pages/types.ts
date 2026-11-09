import { extname } from 'node:path';

// Content type by extension; an extension-less path is HTML, an unknown extension is bytes.
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
  '.map': 'application/json',
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
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.avif': 'image/avif',
  '.webm': 'video/webm',
};

const TEXT_APPLICATION = /^application\/(json|javascript|xml|manifest\+json)$|\+(json|xml)$/;

// A text type is read as a string (parameters like charset ignored); every other type as bytes.
export const isText = (type: string): boolean => {
  const media = (type.split(';')[0] ?? '').trim().toLowerCase();
  return media.startsWith('text/') || TEXT_APPLICATION.test(media);
};

export const typeOf = (path: string): string => {
  const ext = extname(path);
  return TYPES[ext] ?? (ext === '' ? 'text/html' : 'application/octet-stream');
};

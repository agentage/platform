import { normalize, posix } from 'node:path';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { entryOf, normalizeParts } from '../../manifest/parts.js';
import { IMAGE_PART_KINDS, type ImagePartKind } from '../../manifest/primitives.schema.js';
import { type Finding } from '../check.js';

type Part = ImagePartKind | 'cli';

const PARTS: readonly string[] = [...IMAGE_PART_KINDS, 'cli'];
const PART_FOLDER = /^(?:src|dist\/(?:pages|ui|api|mcp|worker|cli))(?:\/|$)/;
const RELATIVE = /\b(?:from|import)\s*\(?\s*(['"])(\.{1,2}\/[^'"]*)\1/g;

// Each image carries one part folder and src/lib, so a part imports nothing else.
export const crossPartImports = (file: string, code: string): Finding[] => {
  const [src, part = ''] = file.split('/');
  if (src !== 'src' || !PARTS.includes(part)) return [];
  return [...code.matchAll(RELATIVE)].flatMap((m) => {
    const target = posix.join(posix.dirname(file), m[2] ?? '');
    if (target.startsWith(`src/${part}/`) || target.startsWith('src/lib/')) return [];
    const line = code.slice(0, m.index).split('\n').length;
    return [
      { file, line, problem: `imports ${m[2]}: a part imports only its own folder and src/lib` },
    ];
  });
};

const targets = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Object.values(Object(value)).flatMap(targets);

// The package is the manifest and the record; part code reaches users only through its image.
export const exportedPartCode = (pkg: ExtensionPackage): Finding[] => {
  const parts = Object.keys(normalizeParts(pkg.agentage.parts).code) as Part[];
  const entries = parts.map((part) => normalize(entryOf(pkg, part)));
  const partCode = (target: string) =>
    PART_FOLDER.test(normalize(target)) || entries.includes(normalize(target));
  const exported = targets((pkg as { exports?: unknown }).exports).filter(partCode);
  return exported.map((target) => ({
    file: 'package.json',
    problem: `exports ${target}: the package exports no part code`,
  }));
};

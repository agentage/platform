import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const importsOf = (file: string): string[] =>
  [
    ...readFileSync(file, 'utf8').matchAll(/^(?:import|export) (?!type )[^;]*?from '([^']+)'/gms),
  ].map((match) => match[1] ?? '');

const reachable = (entry: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const spec of importsOf(entry)) {
    if (spec.startsWith('.')) reachable(join(dirname(entry), spec.replace(/\.js$/, '.ts')), seen);
    else seen.add(spec);
  }
  return seen;
};

// The bare specifiers (packages and node: builtins) an entry reaches through its value imports.
export const externalImports = (entry: string): string[] =>
  [...reachable(entry)].filter((spec) => !spec.startsWith('/')).sort();

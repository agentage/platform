import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..');

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

// The cli imports @agentage/extension/tool; the server stack must stay out of that graph.
describe('tool entry', () => {
  it('loads no server dependency', () => {
    const graph = [...reachable(join(SRC, 'tool', 'index.ts'))];
    const external = graph.filter((spec) => !spec.startsWith('/'));
    expect(external.filter((spec) => !spec.startsWith('node:')).sort()).toEqual(['semver', 'zod']);
  });
});

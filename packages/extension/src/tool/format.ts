import { relative } from 'node:path';
import { type BuildResult } from './build.js';

const shortDigest = (digest: string): string => digest.slice(0, 'sha256:'.length + 8);

// One line per image, the record path last: what `agentage extension build` prints.
export const buildLines = (result: BuildResult, cwd: string = process.cwd()): string[] => {
  const width = Math.max(...result.images.map((image) => image.tag.length)) + 2;
  const lines = result.images.map((image) => {
    const state = image.digest ? `${shortDigest(image.digest)} pushed` : 'built';
    return `${image.part.padEnd(8)}${image.tag.padEnd(width)}${state}`;
  });
  if (result.recordFile) lines.push(`${'record'.padEnd(8)}${relative(cwd, result.recordFile)}`);
  return lines;
};

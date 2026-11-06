import { relative } from 'node:path';
import { type BuildResult } from './build.js';
import { type CheckReport, type Finding } from './check.js';
import { plural } from './up/lines.js';

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

const where = ({ file, line }: Finding): string =>
  file ? `${file}${line ? `:${line}` : ''} ` : '';

export const problemLines = (report: CheckReport): string[] =>
  report.problems.map((found) => `${found.rule}: ${where(found)}${found.problem}`);

// What `agentage extension check` prints (sheet C2): the rules line and PASS, or each problem and FAIL.
export const checkLines = (report: CheckReport): string[] => {
  const { rules, skipped, problems } = report;
  if (report.conforms) {
    const states = rules.map(
      (name) => `${name} ${skipped[name] ? `skipped: ${skipped[name]}` : 'ok'}`
    );
    const pass = `PASS ${report.id} ${report.version} conforms (${plural(rules.length, 'rule')})`;
    return [states.join(' · '), pass];
  }
  const failed = new Set(problems.map((found) => found.rule)).size;
  const fail = `FAIL ${plural(problems.length, 'problem')} in ${plural(failed, 'rule')}`;
  return [...problemLines(report), fail];
};

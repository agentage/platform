import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// The kit carries @agentage/logs in its own dist, so its tarball installs without that package on npm.
const root = join(import.meta.dirname, '..');
const dist = join(root, 'packages/extension/dist');
const vendor = join(dist, 'vendor/logs');
rmSync(vendor, { recursive: true, force: true });
cpSync(join(root, 'packages/logs/dist'), vendor, {
  recursive: true,
  filter: (src) => !/\.test\./.test(src),
});

const SPEC = /(['"])@agentage\/logs\1/;
const files = readdirSync(dist, { recursive: true }).filter(
  (f) => /\.(js|d\.ts)$/.test(f) && !f.startsWith('vendor/')
);
let rewritten = 0;
for (const file of files) {
  const path = join(dist, file);
  const before = readFileSync(path, 'utf8');
  const target = relative(dirname(path), join(vendor, 'index.js'));
  const spec = target.startsWith('.') ? target : `./${target}`;
  const after = before.replace(new RegExp(SPEC, 'g'), `'${spec}'`);
  if (after !== before) {
    writeFileSync(path, after);
    rewritten++;
  }
}
const left = files.filter((f) => SPEC.test(readFileSync(join(dist, f), 'utf8')));
if (left.length > 0) throw new Error(`@agentage/logs still imported by ${left.join(', ')}`);
console.log(`inline-logs: vendor/logs copied, ${rewritten} files rewritten`);

#!/usr/bin/env node
import { createLog } from '../log/log.js';
import { partLog, runPart } from './run-part.js';

// Image entry: `node node_modules/@agentage/extension/dist/runtime/main.js api` in /app.
const part = process.argv[2] ?? 'api';
const crashLog = () => partLog() ?? createLog({ extension: 'unknown', part });
process.on('uncaughtException', (err) => {
  crashLog().error(err, 'uncaughtException');
  process.exit(1);
});
try {
  await runPart({ dir: process.cwd(), part, env: process.env });
} catch (err) {
  // The manifest may be what failed, so the id is not known here; the line keeps the stack.
  crashLog().error(err);
  process.exit(1);
}

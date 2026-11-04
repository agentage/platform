#!/usr/bin/env node
import { createLog } from '../log/log.js';
import { runPart } from './run-part.js';

// Image entry: `node node_modules/@agentage/extension/dist/runtime/main.js api` in /app.
const part = process.argv[2] ?? 'api';
try {
  await runPart({ dir: process.cwd(), part, env: process.env });
} catch (err) {
  // The manifest may be what failed, so the id is not known here; the line keeps the stack.
  createLog({ extension: 'unknown', part }).error(err);
  process.exit(1);
}

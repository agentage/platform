#!/usr/bin/env node
import { runPart } from './run-part.js';

// Image entry: `node node_modules/@agentage/extension/dist/runtime/main.js api` in /app.
try {
  await runPart({ dir: process.cwd(), part: process.argv[2] ?? 'api', env: process.env });
} catch (err) {
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: String(err) })}\n`);
  process.exit(1);
}

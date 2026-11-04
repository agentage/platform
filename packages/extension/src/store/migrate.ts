#!/usr/bin/env node
import { createLog } from '../log/log.js';
import { readManifest } from '../manifest/read-manifest.js';
import { migrate } from './migrations.js';
import { createStore } from './store.js';

// The api image's migrate entry (`node dist/store/migrate.js` in /app), run as a job before a rollout.
const log = createLog({ extension: 'unknown', part: 'migrate' });
try {
  const pkg = await readManifest(process.cwd());
  const store = createStore(process.env, log);
  const result = await migrate(
    store,
    process.cwd(),
    createLog({ extension: pkg.agentage.id, part: 'migrate' })
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await store.end();
} catch (err) {
  log.error(err);
  process.exit(1);
}

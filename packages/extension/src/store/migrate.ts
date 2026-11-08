#!/usr/bin/env node
import { createLog } from '../log/log.js';
import { readManifest } from '../manifest/read-manifest.js';
import { migrate } from './migrations.js';
import { createStore, type StoreTimeouts } from './store.js';

// A migration may rewrite a table: minutes, not a request's seconds; the job itself has no retry.
const MIGRATE_TIMEOUTS: StoreTimeouts = { connectMs: 10_000, statementMs: 300_000 };

// The api image's migrate job (`node dist/store/migrate.js`); lines before the manifest read 'unknown'.
let log = createLog({ extension: 'unknown', part: 'migrate' });
try {
  const pkg = await readManifest(process.cwd());
  log = createLog({ extension: pkg.agentage.id, part: 'migrate', version: pkg.version });
  const store = createStore(process.env, log, MIGRATE_TIMEOUTS);
  const result = await migrate(store, process.cwd(), log);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await store.end();
} catch (err) {
  log.error(err);
  process.exit(1);
}

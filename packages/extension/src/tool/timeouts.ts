// Every outbound call the tool makes and how long it may take. None retries: a step that times
// out stops with its name, and running it again is safe (build, up and down are idempotent).
export const TIMEOUTS = {
  // git rev-parse, docker image inspect, compose ps, logs and down, the port check
  command: 120_000,
  // the package's own npm run build
  compile: 600_000,
  // docker build: a cold cache pulls the node base image and runs npm ci
  build: 1_200_000,
  // docker push to the registry
  push: 600_000,
  // compose up: the store and gateway images are pulled on first use
  start: 600_000,
  // compose run migrate: the store's migrations and seeds
  migrate: 300_000,
  // POST /token to the dev issuer
  issuer: 5_000,
} as const;

// SIGTERM first; a command that ignores it is killed this long after.
export const KILL_GRACE_MS = 5_000;

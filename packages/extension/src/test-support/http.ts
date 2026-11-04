import { symlink } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Express } from 'express';
import { createLog, type Log } from '../log/log.js';
import { listen } from '../server/serve.js';

export interface Served {
  url: string;
  close(): Promise<void>;
}

// A kit app on 127.0.0.1, port chosen by the OS: /health answers only on loopback.
export const serveApp = async (app: Express): Promise<Served> => {
  const server = await listen(app, 0, '127.0.0.1');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise((resolve) => server.close(() => resolve())) };
};

export interface RecordedLog {
  log: Log;
  lines: Record<string, unknown>[];
}

export const recordedLog = (): RecordedLog => {
  const lines: Record<string, unknown>[] = [];
  const write = (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>);
  return { log: createLog({ extension: 'probe', part: 'test' }, write), lines };
};

const REPO_MODULES = fileURLToPath(new URL('../../../../node_modules', import.meta.url));

// A temp package imports zod and the kit's deps from the repo, one instance with the kit's own.
export const linkModules = (dir: string): Promise<void> =>
  symlink(REPO_MODULES, join(dir, 'node_modules'), 'dir');

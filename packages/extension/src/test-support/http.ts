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
  // An idle keep-alive socket left by an aborted fetch would hold close() for 4 s.
  const close = () =>
    new Promise<void>((resolve) => (server.close(() => resolve()), server.closeAllConnections()));
  return { url, close };
};

export interface RecordedLog {
  log: Log;
  lines: Record<string, unknown>[];
}

export const recordedLog = (): RecordedLog => {
  const lines: Record<string, unknown>[] = [];
  // The row with its fields lifted to the top, so a test reads line['reason'] as before.
  const write = (line: string) => {
    const row = JSON.parse(line) as Record<string, unknown>;
    lines.push({ ...row, ...(row['fields'] as Record<string, unknown>) });
  };
  return { log: createLog({ extension: 'probe', part: 'test' }, write), lines };
};

const REPO_MODULES = fileURLToPath(new URL('../../../../node_modules', import.meta.url));

// A temp package imports zod and the kit's deps from the repo, one instance with the kit's own.
export const linkModules = (dir: string): Promise<void> =>
  symlink(REPO_MODULES, join(dir, 'node_modules'), 'dir');

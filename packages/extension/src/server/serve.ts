import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Express } from 'express';
import { type Log } from '../log/log.js';

export interface ServeOptions {
  app: Express;
  port: number;
  log: Log;
  graceMs?: number;
  exit?: (code: number) => void;
  signals?: NodeJS.Signals[];
}

export const listen = (app: Express, port: number, host?: string): Promise<Server> =>
  new Promise((resolve, reject) => {
    const done = (err?: Error): void => (err ? reject(err) : resolve(server));
    const server = host === undefined ? app.listen(port, done) : app.listen(port, host, done);
  });

// SIGTERM drains: no new connections, idle ones closed, a hard exit after the grace period.
export const shutdownOn = (server: Server, options: ServeOptions): (() => void) => {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const stop = (): void => {
    options.log.info('shutting down');
    server.close(() => exit(0));
    server.closeIdleConnections();
    setTimeout(() => exit(0), options.graceMs ?? 10_000).unref();
  };
  for (const signal of options.signals ?? ['SIGTERM', 'SIGINT']) process.once(signal, stop);
  return stop;
};

export const serve = async (options: ServeOptions): Promise<Server> => {
  const server = await listen(options.app, options.port);
  shutdownOn(server, options);
  options.log.info('listening', { port: (server.address() as AddressInfo).port });
  return server;
};

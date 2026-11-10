import { type Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createTestContext } from '../context/test-context.js';
import { listen, serve, shutdownOn } from './serve.js';

describe('serve', () => {
  it('listens, then drains on stop and exits 0', async () => {
    const ctx = createTestContext();
    const exit = vi.fn();
    const server = await serve({ app: express(), port: 0, log: ctx.log, exit, signals: [] });
    expect(server.listening).toBe(true);
    const stop = shutdownOn(server, { app: express(), port: 0, log: ctx.log, exit, signals: [] });
    stop();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(ctx.logs.map((entry) => entry.message)).toEqual(['listening', 'shutting down']);
  });

  it('exits 1 after the 10 s grace period when connections never drain', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const exit = vi.fn();
      const stuck = { close: vi.fn(), closeIdleConnections: vi.fn() } as unknown as Server;
      shutdownOn(stuck, {
        app: express(),
        port: 0,
        log: createTestContext().log,
        exit,
        signals: [],
      })();
      vi.advanceTimersByTime(9_999);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when the port is taken', async () => {
    const first = await listen(express(), 0, '127.0.0.1');
    const address = first.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await expect(listen(express(), port, '127.0.0.1')).rejects.toThrow(/EADDRINUSE/);
    first.close();
  });

  it('a second stop or signal mid-drain is one drain and one exit', async () => {
    const ctx = createTestContext();
    const exit = vi.fn();
    const server = await listen(express(), 0);
    const close = vi.spyOn(server, 'close');
    const stop = shutdownOn(server, {
      app: express(),
      port: 0,
      log: ctx.log,
      exit,
      signals: ['SIGUSR2'],
    });
    stop();
    process.emit('SIGUSR2');
    expect(process.listenerCount('SIGUSR2')).toBe(1);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledOnce());
    expect([close.mock.calls.length, ctx.logs.length]).toEqual([1, 1]);
    process.removeAllListeners('SIGUSR2');
  });

  it('a close error exits 1; a second Ctrl-C mid-drain exits 130 at once', async () => {
    const exit = vi.fn();
    const log = createTestContext().log;
    const closed = await listen(express(), 0);
    closed.close();
    shutdownOn(closed, { app: express(), port: 0, log, exit, signals: [] })();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    const stuck = { close: vi.fn(), closeIdleConnections: vi.fn() } as unknown as Server;
    const interrupted = vi.fn();
    shutdownOn(stuck, { app: express(), port: 0, log, exit: interrupted, signals: ['SIGUSR2'] });
    process.emit('SIGUSR2');
    expect(interrupted).not.toHaveBeenCalled();
    process.removeAllListeners('SIGUSR2');
    const ctrlC = vi.fn();
    const onInt = process.listeners('SIGINT');
    shutdownOn(stuck, { app: express(), port: 0, log, exit: ctrlC, signals: ['SIGINT'] });
    process.emit('SIGINT');
    process.emit('SIGINT');
    expect(ctrlC.mock.calls).toEqual([[130]]);
    process.removeAllListeners('SIGINT');
    for (const listener of onInt) process.on('SIGINT', listener);
  });
});

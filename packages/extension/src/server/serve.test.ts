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

  it('exits 0 after the 10 s grace period when connections never drain', () => {
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
      expect(exit).toHaveBeenCalledWith(0);
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
});

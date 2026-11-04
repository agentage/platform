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

  it('rejects when the port is taken', async () => {
    const first = await listen(express(), 0, '127.0.0.1');
    const address = first.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await expect(listen(express(), port, '127.0.0.1')).rejects.toThrow(/EADDRINUSE/);
    first.close();
  });
});

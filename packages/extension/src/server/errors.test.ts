import { type Request, type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { errorHandler } from './errors.js';

describe('errorHandler', () => {
  it('on a started response logs the error and closes it, writing nothing', () => {
    const { lines, log } = recordedLog();
    const res = { headersSent: true, destroy: vi.fn(), status: vi.fn() };
    errorHandler(log)(new Error('boom'), {} as Request, res as unknown as Response, vi.fn());
    expect([res.destroy.mock.calls.length, res.status.mock.calls.length]).toEqual([1, 0]);
    expect(lines.map((line) => [line['level'], line['msg']])).toEqual([['error', 'boom']]);
  });
});

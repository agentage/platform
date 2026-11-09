import express, { type Request, type Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { errorHandler } from './errors.js';

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const handle = (err: unknown, res: object) => {
  const { lines, log } = recordedLog();
  errorHandler(log)(err, {} as Request, res as Response, vi.fn());
  return lines.map((line) => [line['level'], line['msg']]);
};

const coded = (code: string) => Object.assign(new Error(code), { code });

describe('errorHandler', () => {
  it('on a started response logs the error and closes it, writing nothing', () => {
    const res = { headersSent: true, destroy: vi.fn(), status: vi.fn() };
    expect(handle(new Error('boom'), res)).toEqual([['error', 'Error: boom']]);
    expect([res.destroy.mock.calls.length, res.status.mock.calls.length]).toEqual([1, 0]);
  });

  it('a client gone mid-answer or mid-upload is one warn line, nothing written', () => {
    for (const code of ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNABORTED']) {
      const res = {
        headersSent: false,
        socket: { destroyed: true },
        destroy: vi.fn(),
        status: vi.fn(),
      };
      expect(handle(coded(code), res), code).toEqual([['warn', 'client closed early']]);
      expect([res.destroy.mock.calls.length, res.status.mock.calls.length]).toEqual([1, 0]);
    }
  });

  it('an app-side premature close before headers is the JSON 500 and an error line', async () => {
    const { lines, log } = recordedLog();
    const app = express().get('/', () => {
      throw coded('ERR_STREAM_PREMATURE_CLOSE');
    });
    served = await serveApp(app.use(errorHandler(log)));
    const res = await fetch(served.url);
    expect([res.status, await res.json()]).toMatchObject([500, { error: { code: 'INTERNAL' } }]);
    expect(lines.map((line) => line['level'])).toEqual(['error']);
  });
});

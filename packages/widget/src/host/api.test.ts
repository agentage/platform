import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse } from '../test-support/fetch.js';
import { callApi } from './api.js';

const anonymous = () => Promise.resolve(undefined);
const withToken = () => Promise.resolve('aga_t');

describe('callApi', () => {
  it('fetches /api/v1{path} and resolves the envelope data', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ success: true, data: { n: 3 } }));
    await expect(callApi(fetch, anonymous, '/ticks?limit=1')).resolves.toEqual({ n: 3 });
    expect(calls[0]?.url).toBe('/api/v1/ticks?limit=1');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
  });

  it('keeps the caller init and adds the bearer', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ success: true, data: null }));
    const init = { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } };
    await callApi(fetch, withToken, '/echo', init);
    const headers = new Headers(calls[0]?.init.headers);
    expect(calls[0]?.init.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer aga_t');
  });

  it('rejects with the error code on success: false', async () => {
    const failure = { success: false, error: { code: 'VALIDATION', message: 'msg is required' } };
    const { fetch } = fakeFetch(jsonResponse(failure, 400));
    await expect(callApi(fetch, anonymous, '/echo')).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'msg is required',
    });
  });

  it('rejects a body that is not an envelope and a relative path', async () => {
    const { fetch } = fakeFetch(jsonResponse('oops', 500, 'text/plain'));
    await expect(callApi(fetch, anonymous, '/echo')).rejects.toMatchObject({ code: 'HTTP_500' });
    await expect(callApi(fetch, anonymous, 'echo')).rejects.toMatchObject({ code: 'BAD_PATH' });
  });
});

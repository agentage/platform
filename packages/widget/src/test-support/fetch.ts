import { vi } from 'vitest';
import { type FetchLike } from '../host/host.types.js';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export const jsonResponse = (body: unknown, status = 200, type = 'application/json'): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': type },
  });

export const fakeFetch = (...answers: Response[]) => {
  const calls: RecordedCall[] = [];
  const fetch = vi.fn<FetchLike>((url, init = {}) => {
    calls.push({ url, init });
    const answer = answers.shift();
    return answer ? Promise.resolve(answer) : Promise.reject(new Error('no more answers'));
  });
  return { fetch, calls };
};

export const toolAnswer = (result: unknown, id = 1) => jsonResponse({ result, jsonrpc: '2.0', id });

import { describe, expect, it } from 'vitest';
import { requestScope } from './current.js';
import { kitFetch } from './fetch.js';
import { agcidMiddleware } from './scope.js';

const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const UUID_V7 = /^[0-9a-f]{12}7[0-9a-f]{19}$/;
const KEEP = '0194f2a87c1e7b3a9d405e2f6a1c8b77';

const fake = () => {
  const sent: Headers[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    sent.push(new Headers(init?.headers));
    return new Response('{}');
  }) as typeof fetch;
  return { sent, impl };
};

// Runs fn inside the scope the request middleware opens for these incoming headers.
const inRequest = (headers: Record<string, string>, fn: () => Promise<unknown>) =>
  new Promise((resolve) => {
    const req = { get: (name: string) => headers[name], path: '/' };
    const res = { locals: {}, setHeader: () => undefined };
    agcidMiddleware(req as never, res as never, () => void fn().then(resolve));
  });

describe('kitFetch', () => {
  it('forwards the request agcid and traceparent, keeping the caller headers', async () => {
    const { sent, impl } = fake();
    const call = () => kitFetch('http://x', { headers: { accept: 'text/plain' } }, impl);
    await inRequest({ agcid: KEEP, traceparent: TRACE }, call);
    expect(sent[0]?.get('agcid')).toBe(KEEP);
    expect(sent[0]?.get('traceparent')).toBe(TRACE);
    expect(sent[0]?.get('accept')).toBe('text/plain');
  });

  it('drops a malformed traceparent and sends a fresh agcid outside a scope', async () => {
    const { sent, impl } = fake();
    await inRequest({ agcid: KEEP, traceparent: 'junk' }, () => kitFetch('http://x', {}, impl));
    await kitFetch('http://x', {}, impl);
    await requestScope.run({ agcid: 'job-run-agcid' }, () => kitFetch('http://x', {}, impl));
    expect(sent[0]?.has('traceparent')).toBe(false);
    expect(sent[1]?.get('agcid')).toMatch(UUID_V7);
    expect(sent[1]?.has('traceparent')).toBe(false);
    expect(sent[2]?.get('agcid')).toBe('job-run-agcid');
  });
});

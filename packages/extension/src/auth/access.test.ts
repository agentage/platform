import { describe, expect, it } from 'vitest';
import { routeAccess } from './route-access.js';
import { accessOfSecurity, strongest } from './token-check.js';

const DOC = {
  openapi: '3.1.0',
  security: [{ agentage: ['probe:read'] }],
  paths: {
    '/api/v1/echo': { get: { security: [] } },
    '/api/v1/ticks': { get: {}, post: { security: [{ agentage: ['probe:write'] }] } },
    '/api/v1/ticks/{id}': { delete: { security: [{ agentage: ['probe:admin'] }] } },
  },
};

describe('access', () => {
  it('reads public, a verb, or read from OpenAPI security', () => {
    expect(accessOfSecurity([])).toBe('public');
    expect(accessOfSecurity([{ agentage: ['probe:write'] }])).toBe('write');
    expect(accessOfSecurity([{ agentage: ['probe:read', 'probe:admin'] }])).toBe('admin');
    expect(accessOfSecurity(undefined)).toBe('read');
    expect(accessOfSecurity([{ agentage: ['odd'] }])).toBe('read');
  });

  it('finds the operation of a request, templates included; anything undeclared needs read', () => {
    expect(routeAccess(DOC, 'GET', '/api/v1/echo')).toBe('public');
    expect(routeAccess(DOC, 'GET', '/api/v1/ticks')).toBe('read');
    expect(routeAccess(DOC, 'POST', '/api/v1/ticks')).toBe('write');
    expect(routeAccess(DOC, 'DELETE', '/api/v1/ticks/42')).toBe('admin');
    expect(routeAccess(DOC, 'PUT', '/api/v1/echo')).toBe('read');
    expect(routeAccess(DOC, 'GET', '/api/v1/nope')).toBe('read');
    expect(routeAccess(null, 'GET', '/api/v1/echo')).toBe('read');
  });

  it('takes the strongest of several needs', () => {
    expect(strongest([])).toBe('public');
    expect(strongest(['read', 'admin', 'write'])).toBe('admin');
  });
});

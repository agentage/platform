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

  it('picks the most specific path: a concrete one over a template listed before it', () => {
    const doc = {
      paths: {
        '/x/{id}': { get: { security: [] } },
        '/x/admin': { get: { security: [{ agentage: ['probe:admin'] }] } },
        '/x/{id}/{part}': { get: { security: [] } },
        '/x/{id}/notes': { get: { security: [{ agentage: ['probe:write'] }] } },
      },
    };
    expect(routeAccess(doc, 'GET', '/x/admin')).toBe('admin');
    expect(routeAccess(doc, 'GET', '/x/42')).toBe('public');
    expect(routeAccess(doc, 'GET', '/x/42/notes')).toBe('write');
    expect(routeAccess(doc, 'GET', '/x/42/other')).toBe('public');
  });

  it('takes the strongest of several needs', () => {
    expect(strongest([])).toBe('public');
    expect(strongest(['read', 'admin', 'write'])).toBe('admin');
  });
});

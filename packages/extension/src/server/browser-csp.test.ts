import { describe, expect, it } from 'vitest';
import { browserCsp, siblingSource } from './browser-csp.js';

const ISSUER = 'https://auth.agentage.io';

const directivesFor = (origin: string) => browserCsp({ origin, issuer: `${ISSUER}/` }).directives;

describe('browser CSP', () => {
  it('lets a next host load and call its siblings and call the issuer', () => {
    expect(directivesFor('https://fixture.next.agentage.io')).toEqual({
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://*.next.agentage.io'],
      connectSrc: ["'self'", ISSUER, 'https://*.next.agentage.io'],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    });
  });

  it('takes the parent of a production host', () => {
    expect(directivesFor('https://fixture.agentage.io').scriptSrc).toEqual([
      "'self'",
      'https://*.agentage.io',
    ]);
  });

  it('names no sibling for one label, a bare domain, an IP or no origin', () => {
    for (const origin of ['http://localhost:4280', 'https://agentage.io', 'http://127.0.0.1:4280'])
      expect(siblingSource(origin), origin).toEqual([]);
    expect(siblingSource('http://[::1]:4280')).toEqual([]);
    expect(siblingSource(undefined)).toEqual([]);
    expect(browserCsp({}).directives.connectSrc).toEqual(["'self'"]);
  });

  it('adds the dev issuer after the issuer', () => {
    const csp = browserCsp({ issuer: 'http://issuer:3000', devIssuer: 'http://localhost:4281' });
    expect(csp.directives.connectSrc).toEqual([
      "'self'",
      'http://issuer:3000',
      'http://localhost:4281',
    ]);
  });
});

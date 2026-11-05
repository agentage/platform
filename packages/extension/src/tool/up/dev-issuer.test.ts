import { afterEach, describe, expect, it, vi } from 'vitest';

const listened = vi.hoisted(() => ({ port: -1, settings: {} }));

// The entry listens forever; here the issuer only records where it would listen.
vi.mock('./dev-issuer-app.js', () => ({
  DEV_ISSUER: 'http://localhost:4281',
  DEV_AUDIENCE: 'localhost',
  createIssuer: (settings: object) => ({
    listen: (port: number, done: () => void) => {
      listened.port = port;
      listened.settings = settings;
      done();
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the dev issuer entry', () => {
  it('listens on PORT, names itself by AGENTAGE_ISSUER and says so on stderr', async () => {
    vi.stubEnv('PORT', '4321');
    vi.stubEnv('AGENTAGE_ISSUER', 'http://issuer:3000');
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((text) => stderr.push(String(text)) > 0);
    await import('./dev-issuer.js');
    expect(listened.port).toBe(4321);
    expect(listened.settings).toEqual({ issuer: 'http://issuer:3000', audience: 'localhost' });
    expect(stderr).toEqual(['dev issuer on :4321\n']);
  });
});

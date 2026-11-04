import { afterEach, describe, expect, it, vi } from 'vitest';

const listened = vi.hoisted(() => ({ port: -1 }));

// The entry listens forever; here the issuer only records where it would listen.
vi.mock('./dev-issuer-app.js', () => ({
  createIssuer: () => ({
    listen: (port: number, done: () => void) => {
      listened.port = port;
      done();
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the dev issuer entry', () => {
  it('listens on PORT and says so on stderr', async () => {
    vi.stubEnv('PORT', '4321');
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((text) => stderr.push(String(text)) > 0);
    await import('./dev-issuer.js');
    expect(listened.port).toBe(4321);
    expect(stderr).toEqual(['dev issuer on :4321\n']);
  });
});

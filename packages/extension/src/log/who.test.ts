import { describe, expect, it } from 'vitest';
import { clientOf, userTypeOf, whoOf } from './who.js';

const headers = (h: Record<string, string>) => (name: string) => h[name];
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36';

describe('who', () => {
  it('user_type: declared first, then an AI client, a bot, a machine, else a person', () => {
    const at = (h: Record<string, string>, path = '/api/v1/x') => userTypeOf(headers(h), path);
    expect(at({ 'x-client-type': 'test', 'user-agent': BROWSER })).toBe('test');
    expect(at({ 'x-client-type': 'service', 'user-agent': 'curl/8.5.0' })).toBe('service');
    expect(at({ 'x-client-type': 'automation' })).toBe('automation');
    expect(at({ 'user-agent': 'curl/8.5.0' })).toBe('automation');
    expect(at({ 'user-agent': 'claude-code/2.1.0' })).toBe('agent');
    expect(at({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).toBe('bot');
    expect(at({ 'user-agent': BROWSER }, '/wp-login.php')).toBe('bot');
    expect(at({ 'user-agent': BROWSER })).toBe('user');
    expect(at({ 'x-client-type': 'admin', 'user-agent': BROWSER })).toBe('user');
  });

  it('client: the x-client header, else the user agent family, else null', () => {
    const at = (h: Record<string, string>) => clientOf(headers(h));
    expect(at({ 'x-client': 'Obsidian', 'user-agent': 'curl/8.5.0' })).toBe('obsidian');
    expect(at({ 'user-agent': 'claude-code/2.1.0' })).toBe('claude-code');
    expect(at({ 'user-agent': `${BROWSER} Cursor/1.4.2` })).toBe('cursor');
    expect(at({ 'user-agent': 'curl/8.5.0' })).toBe('curl');
    expect(at({ 'user-agent': 'node' })).toBe('node');
    expect(at({ 'user-agent': BROWSER })).toBe('browser');
    expect(at({ 'user-agent': 'Wget/1.21' })).toBeNull();
  });

  it('session from agsid, sub filled later by the token check', () => {
    expect(whoOf(headers({ agsid: 'sit_9' }), '/')).toMatchObject({ session: 'sit_9', sub: null });
    expect(whoOf(headers({}), '/')).toMatchObject({ session: null, user_type: 'automation' });
  });
});

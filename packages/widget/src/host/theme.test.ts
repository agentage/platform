// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentTheme } from './theme.js';

const systemLight = (light: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: light && query === '(prefers-color-scheme: light)',
  }));

afterEach(() => vi.unstubAllGlobals());

describe('currentTheme', () => {
  it('takes the host data-theme over the system preference', () => {
    const el = document.createElement('div');
    systemLight(true);
    el.setAttribute('data-theme', 'dark');
    expect(currentTheme(el)).toBe('dark');
    systemLight(false);
    el.setAttribute('data-theme', 'light');
    expect(currentTheme(el)).toBe('light');
  });

  it('falls back to the system for no or an unknown data-theme', () => {
    const el = document.createElement('div');
    systemLight(true);
    expect(currentTheme(el)).toBe('light');
    el.setAttribute('data-theme', 'system');
    expect(currentTheme(el)).toBe('light');
    systemLight(false);
    expect(currentTheme()).toBe('dark');
  });
});

import { type HostContext } from './host.types.js';

// The host element's data-theme decides; else the system, dark being the design-system default.
export const currentTheme = (element?: Element): HostContext['theme'] => {
  const set = element?.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

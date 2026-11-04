import { type HostContext } from './host.types.js';

// Dark is the design-system default; light only when the system asks for it.
export const currentTheme = (): HostContext['theme'] =>
  globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

import { type HostError } from './host.types.js';

export const hostError = (code: string, message: string): HostError =>
  Object.assign(new Error(message), { name: 'HostError', code });

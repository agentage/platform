import { createBridge } from '../host/bridge.js';
import { type Host, type HostFactory } from '../host/host.types.js';

declare global {
  var __agentageHost: HostFactory | undefined;
}

export interface HostedElement extends HTMLElement {
  host?: Host;
}

// A shell-set host wins, then the page hook (the harness), else an anonymous same-origin bridge.
export const resolveHost = (element: HostedElement, id: string, version: string): Host =>
  element.host ?? globalThis.__agentageHost?.(element) ?? createBridge({ id, version });

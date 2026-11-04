import { createContext, useContext, type ReactNode } from 'react';
import { type Host } from './host.types.js';

const HostReactContext = createContext<Host | null>(null);

export const HostProvider = ({ host, children }: { host: Host; children: ReactNode }) => (
  <HostReactContext value={host}>{children}</HostReactContext>
);

export const useHost = (): Host => {
  const host = useContext(HostReactContext);
  if (!host) {
    throw new Error(
      'useHost() must be called inside a widget registered with registerWidgets (no host here)'
    );
  }
  return host;
};

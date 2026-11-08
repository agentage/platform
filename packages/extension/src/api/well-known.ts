// api-standards section 1: the closed names an api part may serve under /.well-known/.
export const WELL_KNOWN = ['agentage.json', 'mcp-registry-auth'] as const;

export type WellKnownName = (typeof WELL_KNOWN)[number];

// A string is sent as text/plain (the registry's domain proof), anything else as JSON.
export type WellKnownDoc = Record<string, unknown> | string;

export type WellKnownRender = () => WellKnownDoc | Promise<WellKnownDoc>;

export type WellKnownRegistrar = (name: WellKnownName, render: WellKnownRender) => void;

export interface WellKnownEntry {
  name: WellKnownName;
  render: WellKnownRender;
}

export const createWellKnownRegistry = () => {
  const documents: WellKnownEntry[] = [];
  const wellKnown: WellKnownRegistrar = (name, render) => {
    if (!WELL_KNOWN.includes(name))
      throw new Error(`well-known ${String(name)}: one of ${WELL_KNOWN.join(', ')}`);
    if (documents.some((entry) => entry.name === name))
      throw new Error(`well-known ${name} is registered twice`);
    documents.push({ name, render });
  };
  return { wellKnown, documents };
};

export interface HostContext {
  extension: string;
  version: string;
  path: string;
  theme: 'light' | 'dark';
}

// Augmented per extension: declare module '@agentage/widget' { interface ToolOutputs { ... } }
export interface ToolOutputs {}

export type ToolOutput<N extends string> = N extends keyof ToolOutputs
  ? ToolOutputs[N]
  : Record<string, unknown>;

export interface Host {
  tool<N extends string>(name: N, args?: Record<string, unknown>): Promise<ToolOutput<N>>;
  api(path: string, init?: RequestInit): Promise<unknown>;
  context: HostContext;
}

export interface HostError extends Error {
  code: string;
}

export type HostFactory = (element: HTMLElement) => Host;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type TokenSource = () => Promise<string | undefined>;

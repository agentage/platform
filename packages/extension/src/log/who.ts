import { type UserType } from '@agentage/logs';

type Header = (name: string) => string | undefined;

const DECLARED: readonly UserType[] = ['test', 'service', 'automation'];

// The user agent families, specific first: an AI client's agent string also says Mozilla.
const FAMILIES: [string, RegExp][] = [
  ['claude-code', /claude-code|claude-cli/i],
  ['cursor', /cursor/i],
  ['chatgpt', /chatgpt|openai/i],
  ['vscode', /vscode|visual studio code/i],
  ['curl', /^curl\//i],
  ['node', /^node|undici|axios|node-fetch/i],
  ['browser', /mozilla/i],
];
const AI = ['claude-code', 'cursor', 'chatgpt'];
const BOT = /bot|crawl|spider|slurp|scan|nikto|zgrab|masscan/i;
const BOT_PATH = /\.(php|asp|aspx|env)$|^\/wp-|^\/\.git/i;
const MACHINE = /^(curl|wget|node|undici|python|go-http|axios|java|okhttp|libwww)/i;

// A header value as a line: control characters out (the length cut is the caller's).
export const printable = (text: string | undefined): string =>
  (text ?? '').replace(/[\u0000-\u001f\u007f]/g, '');

export const declaredType = (header: Header): UserType | undefined => {
  const declared = header('x-client-type') as UserType | undefined;
  return declared && DECLARED.includes(declared) ? declared : undefined;
};

export const clientOf = (header: Header): string | null => {
  const named = printable(header('x-client')).trim().toLowerCase().slice(0, 64);
  if (named) return named;
  const agent = header('user-agent') ?? '';
  return FAMILIES.find(([, pattern]) => pattern.test(agent))?.[0] ?? null;
};

// Declared first, then a known AI client, a crawler or scanner, a machine agent, else a person.
export const userTypeOf = (header: Header, path: string): UserType => {
  const agent = header('user-agent') ?? '';
  const client = clientOf(header);
  const declared = declaredType(header);
  if (declared) return declared;
  if (client && AI.includes(client)) return 'agent';
  if (BOT.test(agent) || BOT_PATH.test(path)) return 'bot';
  return MACHINE.test(agent) ? 'automation' : 'user';
};

export const whoOf = (header: Header, path: string) => ({
  user_type: userTypeOf(header, path),
  client: clientOf(header),
  session: printable(header('agsid')).slice(0, 128) || null,
  sub: null,
});

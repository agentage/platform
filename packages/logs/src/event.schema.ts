import { z } from 'zod';

export const KINDS = ['http', 'mcp', 'job', 'span', 'error', 'event', 'log'] as const;
export const LEVELS = ['info', 'warn', 'error'] as const;
export const USER_TYPES = ['user', 'agent', 'automation', 'service', 'test', 'bot'] as const;
const AGCID_HEX = /^[0-9a-f]{32}$/;

export type Kind = (typeof KINDS)[number];
export type Level = (typeof LEVELS)[number];
export type UserType = (typeof USER_TYPES)[number];
export type Fields = Record<string, unknown>;

const name = z.string().min(1).max(64);
const id = z.string().max(128).nullable().default(null);

// The line (logs-events section 1): snake_case on the wire; host is set by the shipper or the client.
export const EventSchema = z.object({
  ts: z.iso.datetime({ offset: true }),
  level: z.enum(LEVELS),
  kind: z.enum(KINDS),
  msg: z.string().max(2000),
  extension: name,
  part: name,
  version: z.string().max(64).default(''),
  host: z.string().max(253).optional(),
  agcid: z.string().regex(AGCID_HEX).nullable().default(null),
  sub: id,
  session: id,
  user_type: z.enum(USER_TYPES).default('service'),
  client: z.string().max(64).nullable().default(null),
  fields: z.record(z.string(), z.unknown()).default({}),
});

export type Event = z.output<typeof EventSchema>;
export type EventInput = z.input<typeof EventSchema>;

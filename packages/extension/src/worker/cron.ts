// Five fields: minute hour day-of-month month day-of-week (0 or 7 is Sunday), in UTC.
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
] as const;

export interface Cron {
  readonly expression: string;
  readonly sets: readonly ReadonlySet<number>[];
  readonly anyDay: { dom: boolean; dow: boolean };
}

type Field = (typeof FIELDS)[number];

const toInt = (text: string, field: Field): number => {
  const value = Number(text);
  if (!/^[0-9]+$/.test(text) || value < field.min || value > field.max) {
    throw new Error(`cron ${field.name}: ${text} is not ${field.min}-${field.max}`);
  }
  return value;
};

const range = (part: string, field: Field): [number, number] => {
  if (part === '*') return [field.min, field.max];
  const [from = '', to] = part.split('-');
  return [toInt(from, field), to === undefined ? toInt(from, field) : toInt(to, field)];
};

const expand = (part: string, field: Field): number[] => {
  const [base = '', stepText] = part.split('/');
  const step = stepText === undefined ? 1 : Number(stepText);
  if (!Number.isInteger(step) || step < 1)
    throw new Error(`cron ${field.name}: bad step in ${part}`);
  const [from, to] = range(base, field);
  if (from > to) throw new Error(`cron ${field.name}: ${part} runs backwards`);
  const values: number[] = [];
  for (let v = from; v <= to; v += step) values.push(v);
  return values;
};

const fieldSet = (text: string, field: Field): Set<number> => {
  const values = text.split(',').flatMap((part) => expand(part, field));
  return new Set(field.name === 'day of week' ? values.map((v) => v % 7) : values);
};

export const parseCron = (expression: string): Cron => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${expression}": five fields expected`);
  const sets = FIELDS.map((field, i) => fieldSet(parts[i] ?? '', field));
  return { expression, sets, anyDay: { dom: parts[2] === '*', dow: parts[4] === '*' } };
};

// Classic cron: with both day fields restricted, either one matching is enough.
const dayMatches = (cron: Cron, date: Date): boolean => {
  const dom = cron.sets[2]?.has(date.getUTCDate()) ?? false;
  const dow = cron.sets[4]?.has(date.getUTCDay()) ?? false;
  if (cron.anyDay.dom && cron.anyDay.dow) return true;
  if (cron.anyDay.dom) return dow;
  if (cron.anyDay.dow) return dom;
  return dom || dow;
};

export const matches = (cron: Cron, date: Date): boolean =>
  (cron.sets[0]?.has(date.getUTCMinutes()) ?? false) &&
  (cron.sets[1]?.has(date.getUTCHours()) ?? false) &&
  (cron.sets[3]?.has(date.getUTCMonth() + 1) ?? false) &&
  dayMatches(cron, date);

const MINUTE = 60_000;
const HORIZON_MINUTES = 5 * 366 * 24 * 60;

// The first matching minute strictly after `after`.
export const nextRun = (cron: Cron, after: Date): Date => {
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
  for (let i = 0; i < HORIZON_MINUTES; i += 1, t += MINUTE) {
    const date = new Date(t);
    if (matches(cron, date)) return date;
  }
  throw new Error(`cron "${cron.expression}" never runs`);
};

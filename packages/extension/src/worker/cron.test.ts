import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { matches, nextRun, parseCron } from './cron.js';

// A host zone 5:30 off UTC, so a local-time reading of a date shows on a UTC host too.
beforeAll(() => void vi.stubEnv('TZ', 'Asia/Kolkata'));
afterAll(() => void vi.unstubAllEnvs());

const at = (iso: string) => new Date(`${iso}Z`);
const values = (expression: string, field: number) => [
  ...(parseCron(expression).sets[field] ?? []),
];

describe('parseCron', () => {
  it('reads values, lists, ranges, steps and stars per field', () => {
    expect(values('5 * * * *', 0)).toEqual([5]);
    expect(values('1,3,5 * * * *', 0)).toEqual([1, 3, 5]);
    expect(values('* 9-11 * * *', 1)).toEqual([9, 10, 11]);
    expect(values('*/15 * * * *', 0)).toEqual([0, 15, 30, 45]);
    expect(values('10-20/5 * * * *', 0)).toEqual([10, 15, 20]);
    expect(values('* * * 1-3,12 *', 3)).toEqual([1, 2, 3, 12]);
    expect(values('* * * * *', 2)).toHaveLength(31);
  });

  it('takes 0 and 7 as Sunday, and tracks which day fields are stars', () => {
    expect(values('* * * * 0,7', 4)).toEqual([0]);
    expect(values('* * * * 5-7', 4)).toEqual([5, 6, 0]);
    expect(parseCron(' 0 0 1 * * ').anyDay).toEqual({ dom: false, dow: true });
  });

  it('refuses a wrong field count, out of range values, bad steps and backward ranges', () => {
    expect(() => parseCron('* * * *')).toThrow('cron "* * * *": five fields expected');
    expect(() => parseCron('60 * * * *')).toThrow('cron minute: 60 is not 0-59');
    expect(() => parseCron('* 24 * * *')).toThrow('cron hour: 24 is not 0-23');
    expect(() => parseCron('* * 0 * *')).toThrow('cron day of month: 0 is not 1-31');
    expect(() => parseCron('* * * 13 *')).toThrow('cron month: 13 is not 1-12');
    expect(() => parseCron('* * * * 8')).toThrow('cron day of week: 8 is not 0-7');
    expect(() => parseCron('x * * * *')).toThrow(/minute: x is not/);
    expect(() => parseCron('*/0 * * * *')).toThrow('cron minute: bad step in */0');
    expect(() => parseCron('*/x * * * *')).toThrow(/bad step/);
    expect(() => parseCron('30-10 * * * *')).toThrow('cron minute: 30-10 runs backwards');
  });
});

describe('nextRun', () => {
  it('is the first matching minute strictly after the given time, in UTC', () => {
    const every = parseCron('* * * * *');
    expect(nextRun(every, at('2026-11-05T10:00:00'))).toEqual(at('2026-11-05T10:01:00'));
    expect(nextRun(every, at('2026-11-05T10:00:59.999'))).toEqual(at('2026-11-05T10:01:00'));
    const quarter = parseCron('*/15 * * * *');
    expect(nextRun(quarter, at('2026-11-05T10:15:00'))).toEqual(at('2026-11-05T10:30:00'));
    const daily = parseCron('30 2 * * *');
    expect(nextRun(daily, at('2026-12-31T03:00:00'))).toEqual(at('2027-01-01T02:30:00'));
  });

  it('with both day fields restricted, either one matching is enough', () => {
    // 2026-11-05 is a Thursday; "the 10th or any Monday".
    const either = parseCron('0 0 10 * 1');
    expect(nextRun(either, at('2026-11-05T00:00:00'))).toEqual(at('2026-11-09T00:00:00'));
    expect(nextRun(either, at('2026-11-09T00:00:00'))).toEqual(at('2026-11-10T00:00:00'));
    const monday = parseCron('0 0 * * 1');
    expect(nextRun(monday, at('2026-11-09T00:00:00'))).toEqual(at('2026-11-16T00:00:00'));
    const tenth = parseCron('0 0 10 * *');
    expect(nextRun(tenth, at('2026-11-10T00:00:00'))).toEqual(at('2026-12-10T00:00:00'));
  });

  it('matches a date only on every field', () => {
    const cron = parseCron('0 12 * 11 4');
    expect(matches(cron, at('2026-11-05T12:00:00'))).toBe(true);
    expect(matches(cron, at('2026-11-05T12:01:00'))).toBe(false);
    expect(matches(cron, at('2026-12-03T12:00:00'))).toBe(false);
    // 20:00 UTC on Monday 30 November is already Tuesday 1 December in the host zone.
    expect(matches(parseCron('0 20 30 11 *'), at('2026-11-30T20:00:00'))).toBe(true);
    expect(matches(parseCron('0 20 * * 1'), at('2026-11-30T20:00:00'))).toBe(true);
  });

  it('throws for an expression that never runs', () => {
    expect(() => nextRun(parseCron('0 0 31 2 *'), at('2026-01-01T00:00:00'))).toThrow(
      'cron "0 0 31 2 *" never runs'
    );
  });
});

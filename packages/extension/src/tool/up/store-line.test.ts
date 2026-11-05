import { describe, expect, it } from 'vitest';
import { storePhrase, summaryOf } from './store-line.js';

const phrase = (line: object) => storePhrase(summaryOf(`migrated\n${JSON.stringify(line)}\n`));

describe('the store line', () => {
  it('a fresh store: what was applied, as the laptop check reads it', () => {
    expect(phrase({ migrations: 1, applied: 1, seeds: 1, seedsBefore: 0 })).toBe(
      '1 migration applied · 1 seed'
    );
  });

  it('a kept volume: already applied, and a new file beside the old ones', () => {
    expect(phrase({ migrations: 1, applied: 0, seeds: 0, seedsBefore: 1 })).toBe(
      '1 migration already applied · 1 seed already applied'
    );
    expect(phrase({ migrations: 3, applied: 1, seeds: 0, seedsBefore: 2 })).toBe(
      '1 migration applied, 2 already applied · 2 seeds already applied'
    );
  });

  it('an api image on kit 0.2.0 prints no seedsBefore: the migrations still say already', () => {
    expect(phrase({ migrations: 1, applied: 0, seeds: 0 })).toBe(
      '1 migration already applied · 0 seeds'
    );
    expect(phrase({ migrations: 0, applied: 0, seeds: 0 })).toBe('0 migrations applied · 0 seeds');
  });

  it('refuses output without a summary line', () => {
    expect(() => summaryOf('Error: connect ECONNREFUSED')).toThrow(
      'the migrate job printed no summary: Error: connect ECONNREFUSED'
    );
  });
});

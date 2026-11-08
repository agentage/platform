import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InstallationSchema } from './installation.schema.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const fixture = JSON.parse(read('../fixtures/installation.json'));

describe('the installation document', () => {
  it('the committed fixture parses unchanged', () => {
    expect(InstallationSchema.parse(fixture)).toEqual(fixture);
  });

  it("is the README's document", () => {
    const block = /## The installation document\n\n```json\n([\s\S]*?)```/.exec(
      read('../README.md')
    );
    expect(JSON.parse(block?.[1] ?? 'null')).toEqual(fixture);
  });
});

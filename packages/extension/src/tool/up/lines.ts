// What `up` and `down` print: a label, what it is, the detail; the columns line up as in a terminal.
export const stepLine = (label: string, what: string, detail = ''): string =>
  `${label.padEnd(9)}${what.padEnd(45)}${detail}`.trimEnd();

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

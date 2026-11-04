import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const template = join(dirname(fileURLToPath(import.meta.url)), '../../harness/harness.html');

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export const harnessPage = async (id: string, version: string): Promise<string> => {
  const html = await readFile(template, 'utf8');
  return html.replaceAll('{{id}}', escapeHtml(id)).replaceAll('{{version}}', escapeHtml(version));
};

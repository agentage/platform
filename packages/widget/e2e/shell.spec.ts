import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { bundle } from '../dist/bundle/index.js';
import { startStub, type McpCall } from './stub-server.js';

const fixture = fileURLToPath(new URL('../src/test-support/fixture', import.meta.url));
const port = Number(process.env.WIDGET_E2E_PORT ?? 4290);
const origin = `http://localhost:${port}`;
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>shell</title>
<script type="module" src="./shell.js"></script></head><body><main id="shell"></main></body></html>`;
let calls: McpCall[] = [];
let widgets: unknown[] = [];
let version = '';
let close: () => void = () => undefined;

test.beforeAll(async () => {
  const result = await bundle({ dir: fixture });
  widgets = result.widgets;
  version = result.version;
  const entryPoints = [fileURLToPath(new URL('./shell-page.ts', import.meta.url))];
  const outfile = join(result.outDir, 'shell.js');
  await build({
    entryPoints,
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
  });
  await writeFile(join(result.outDir, 'shell.html'), page);
  const stub = await startStub(result.outDir, port);
  calls = stub.calls;
  close = () => stub.server.close();
});

test.afterAll(() => close());

test('the shell mounts probe echo from a static installation, with its host and token', async ({
  page: tab,
}) => {
  const problems: string[] = [];
  tab.on('pageerror', (error) => problems.push(error.message));
  const layout = {
    kind: 'column',
    children: [
      { kind: 'widget', extension: 'probe', name: 'echo' },
      { kind: 'widget', extension: 'probe', name: 'missing' },
    ],
  };
  const data = { target: 'harness', deployments: [{ id: 'probe', url: origin }], layout };
  await tab.route('**/api/v1/installations/harness', (route) =>
    route.fulfill({ json: { success: true, data } })
  );
  await tab.route('**/.well-known/agentage-extension.json', (route) =>
    route.fulfill({ json: { id: 'probe', widgets } })
  );
  await tab.goto(`/ui/${version}/shell.html`);
  await expect(tab.locator('body')).toHaveAttribute('data-mounted', 'true');
  await expect(tab.getByRole('alert')).toHaveText('probe missing: probe serves no widget missing');
  await tab.getByRole('button', { name: 'ping' }).click();
  await expect(tab.locator('[data-layout="column"] > probe-echo')).toContainText('pong hi');
  expect(calls.map((call) => call.headers.authorization)).toEqual(['Bearer aga_shell']);
  expect(problems).toEqual([]);
});

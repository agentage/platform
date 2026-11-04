import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { bundle } from '../dist/bundle/index.js';
import { startStub, type McpCall } from './stub-server.js';

const DEV_ISSUER = 'http://localhost:4281/';
const fixture = fileURLToPath(new URL('../src/test-support/fixture', import.meta.url));
const port = Number(process.env.WIDGET_E2E_PORT ?? 4290);
let calls: McpCall[] = [];
let close: () => void = () => undefined;

test.beforeAll(async () => {
  const result = await bundle({ dir: fixture });
  const stub = await startStub(result.outDir, port);
  calls = stub.calls;
  close = () => stub.server.close();
});

test.afterAll(() => close());

test.beforeEach(() => {
  calls.length = 0;
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`echo widget answers pong hi (${colorScheme})`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.location().url.startsWith(DEV_ISSUER))
        problems.push(msg.text());
    });
    await page.emulateMedia({ colorScheme });
    await page.goto('/ui/0.2.0/harness.html');
    await page.getByRole('button', { name: 'ping' }).click();
    await expect(page.locator('probe-echo')).toContainText('pong hi');
    await expect(page).toHaveScreenshot(`echo-${colorScheme}.png`);
    expect(problems).toEqual([]);
  });
}

test('the harness speaks 2026-07-28 tools/call and keeps the token in the bridge', async ({
  page,
}) => {
  await page.goto('/ui/0.2.0/harness.html?token=aga_e2e');
  await page.getByRole('button', { name: 'ping' }).click();
  await expect(page.locator('probe-echo')).toContainText('pong hi');
  const [call] = calls;
  expect(call?.headers).toMatchObject({
    authorization: 'Bearer aga_e2e',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': 'tools/call',
    'mcp-name': 'probe__echo',
  });
  expect(call?.body).toMatchObject({ method: 'tools/call', params: { name: 'probe__echo' } });
  await expect(page).not.toHaveURL(/token=/);
});

test('without a dev issuer the harness warns once and calls anonymously', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto('/ui/0.2.0/harness.html?widget=echo');
  await page.getByRole('button', { name: 'ping' }).click();
  await expect(page.locator('probe-echo')).toContainText('pong hi');
  expect(warnings.filter((w) => w.includes('no dev token'))).toHaveLength(1);
  expect(calls[0]?.headers.authorization).toBeUndefined();
});

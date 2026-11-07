import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { bundle } from '../dist/bundle/index.js';
import { startStub, type McpCall } from './stub-server.js';

const DEV_ISSUER = 'http://localhost:4281/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const fixture = fileURLToPath(new URL('../src/test-support/fixture', import.meta.url));
const port = Number(process.env.WIDGET_E2E_PORT ?? 4290);
let calls: McpCall[] = [];
let close: () => void = () => undefined;

type HostHook = (el: Element | null) => object;

// Everything widget code on the page can reach: the DOM, the URL, storage and the host it is given.
const widgetReach = () => {
  const el = document.querySelector('probe-echo');
  const host = (globalThis as { __agentageHost?: HostHook }).__agentageHost?.(el) ?? {};
  const seen = [document.documentElement.outerHTML, el?.shadowRoot?.innerHTML, location.href];
  seen.push(JSON.stringify(host), JSON.stringify({ ...localStorage, ...sessionStorage }));
  return { keys: Object.keys(host).sort(), seen: seen.join('\n') };
};

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

const opposite = { light: 'dark', dark: 'light' } as const;

// The host attribute decides against the opposite system preference, so the attribute is proven.
for (const theme of ['light', 'dark'] as const) {
  test(`echo widget answers pong hi, axe WCAG A/AA clean (${theme})`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.location().url.startsWith(DEV_ISSUER))
        problems.push(msg.text());
    });
    await page.emulateMedia({ colorScheme: opposite[theme] });
    await page.goto(`/ui/0.2.0/harness.html?theme=${theme}`);
    await expect(page.locator('probe-echo')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'ping' }).click();
    await expect(page.locator('probe-echo')).toContainText('pong hi');
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(violations.map((violation) => violation.id)).toEqual([]);
    await expect(page).toHaveScreenshot(`echo-${theme}.png`);
    expect(problems).toEqual([]);
  });
}

test('a theme toggle on the host reaches the widget at run time', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/ui/0.2.0/harness.html?theme=dark');
  const echo = page.locator('probe-echo');
  const scheme = () => echo.evaluate((el) => getComputedStyle(el).colorScheme);
  await expect(echo.getByRole('button', { name: 'ping' })).toBeVisible();
  expect(await scheme()).toBe('dark');
  await echo.evaluate((el) => el.setAttribute('data-theme', 'light'));
  expect(await scheme()).toBe('light');
  await echo.evaluate((el) => el.removeAttribute('data-theme'));
  expect(await scheme()).toBe('dark');
});

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
  expect(call?.body).toMatchObject({
    method: 'tools/call',
    params: { name: 'probe__echo', arguments: { msg: 'hi' } },
  });
  await expect(page).not.toHaveURL(/token=/);
  const reach = await page.evaluate(widgetReach);
  expect(reach.keys).toEqual(['api', 'context', 'tool']);
  expect(reach.seen).not.toContain('aga_e2e');
});

test('without a dev issuer the harness warns once and calls anonymously', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto('/ui/0.2.0/harness.html?widget=echo');
  await page.getByRole('button', { name: 'ping' }).click();
  await expect(page.locator('probe-echo')).toContainText('pong hi');
  expect(warnings.filter((w) => w.includes('no dev token'))).toHaveLength(1);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.headers.authorization).toBeUndefined();
});

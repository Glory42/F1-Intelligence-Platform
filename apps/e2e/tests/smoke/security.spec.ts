import { test, expect } from '@playwright/test';

test('pages are served with the security headers', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};

  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
});

test('a link padded with params no page reads lands on the plain page', async ({ page }) => {
  await page.goto('/drivers?utm_source=newsletter&year=2026');

  expect(new URL(page.url()).search).toBe('?year=2026');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the enforced CSP blocks nothing on page loads or client-side navigation', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Drivers' }).first().click();
  await page.waitForURL(/\/drivers/);
  await page.goto('/compare/drivers');
  await page.goto('/races');

  expect(violations).toEqual([]);
});

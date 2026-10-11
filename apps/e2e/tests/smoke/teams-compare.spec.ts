import { test, expect } from '@playwright/test';

test('renders both constructors head-to-head from URL params against fixture data', async ({ page }) => {
  const response = await page.goto('/compare/teams?year=2025&a=1&b=2');
  expect(response?.status()).toBe(200);

  await expect(page.getByText('Red Bull Racing').first()).toBeVisible();
  await expect(page.getByText('Ferrari').first()).toBeVisible();

  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
  await expect(page.getByText(/failed to initialize compare page/i)).toHaveCount(0);
});

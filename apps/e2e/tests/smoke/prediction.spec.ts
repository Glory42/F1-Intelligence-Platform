import { test, expect } from '@playwright/test';

test('renders the upcoming prediction and history against fixture data', async ({ page }) => {
  const response = await page.goto('/prediction');
  expect(response?.status()).toBe(200);

  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByText('Italian Grand Prix').first()).toBeVisible();

  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});

test('the race prediction page explains long-run pace with the Friday ranking', async ({ page }) => {
  await page.goto('/prediction/1');

  const table = page.getByRole('table', { name: 'Friday long-run pace' });
  await expect(table.getByRole('row', { name: /LEC.*MEDIUM.*1:24\.120/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /VER.*HARD.*\+0\.230/ })).toBeVisible();
});

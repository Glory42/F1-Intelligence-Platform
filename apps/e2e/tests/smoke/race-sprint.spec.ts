import { test, expect } from '@playwright/test';

test('renders the race-weekend sprint page with results and prediction against fixture data', async ({ page }) => {
  const response = await page.goto('/races/2/sprint');
  expect(response?.status()).toBe(200);

  await expect(page.getByText('São Paulo Grand Prix').first()).toBeVisible();
  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: /results/i })).toBeVisible();

  await expect(page.getByText(/sprint data not found/i)).toHaveCount(0);
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});

test('a sprint weekend grand prix page links to its sprint session', async ({ page }) => {
  await page.goto('/races/2');

  await expect(page.getByRole('link', { name: 'Sprint', exact: true })).toHaveAttribute('href', '/races/2/sprint');
});

test('the sprint page links back to its grand prix', async ({ page }) => {
  await page.goto('/races/2/sprint');

  await expect(page.getByRole('link', { name: 'Grand Prix', exact: true })).toHaveAttribute('href', '/races/2');
});

test('the sprint page shows the sprint session race control messages', async ({ page }) => {
  await page.goto('/races/2/sprint');
  await page.getByRole('tab', { name: 'Incidents' }).click();

  await expect(page.getByText('DOUBLE YELLOW IN TRACK SECTOR 1')).toBeVisible();
});

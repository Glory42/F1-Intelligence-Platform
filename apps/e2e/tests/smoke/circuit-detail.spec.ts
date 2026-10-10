import { test, expect } from '@playwright/test';

test('draws the circuit from real pole-lap telemetry when there is no track image', async ({ page }) => {
  await page.goto('/circuits/monza');

  await expect(page.getByRole('img', { name: 'Autodromo Nazionale Monza layout from pole-lap telemetry' })).toBeVisible();
});

test('the circuit page leads with an overview and keeps the rest in tabs', async ({ page }) => {
  await page.goto('/circuits/monza');

  const views = page.getByRole('navigation', { name: 'Circuit views' });
  await expect(views.getByRole('link')).toHaveText(['Overview', 'Winners', 'Dominance', 'Telemetry']);
  await expect(page.getByRole('heading', { name: 'Recent Winners' })).toHaveCount(0);

  await views.getByRole('link', { name: 'Winners' }).click();
  await expect(page).toHaveURL(/\/circuits\/monza\?tab=winners$/);
  await expect(page.getByRole('heading', { name: 'Recent Winners' })).toBeVisible();
});

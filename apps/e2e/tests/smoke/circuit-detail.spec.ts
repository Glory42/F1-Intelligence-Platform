import { test, expect } from '@playwright/test';

test('draws the circuit from real pole-lap telemetry when there is no track image', async ({ page }) => {
  await page.goto('/circuits/monza');

  await expect(page.getByRole('img', { name: 'Autodromo Nazionale Monza layout from pole-lap telemetry' })).toBeVisible();
});

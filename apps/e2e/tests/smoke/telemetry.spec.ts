import { test, expect } from '@playwright/test';

test('compares two qualifying laps chosen in a plain GET form', async ({ page }) => {
  await page.goto('/races/1');
  await page.getByRole('link', { name: 'Telemetry' }).click();

  await expect(page.getByLabel('Driver A')).toHaveValue('VER');
  await expect(page.getByLabel('Driver B')).toHaveValue('LEC');
  await expect(page.getByText('VER faster in 13 of 25 mini-sectors')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Speed through the lap' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mini-sector dominance map' })).toBeVisible();
});

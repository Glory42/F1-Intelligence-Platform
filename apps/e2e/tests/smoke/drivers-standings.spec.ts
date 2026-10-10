import { test, expect } from '@playwright/test';

test('the driver standings show title odds and who is mathematically out', async ({ page }) => {
  await page.goto('/drivers?year=2026');

  const fight = page.getByRole('region', { name: 'Title fight' });
  await expect(fight.getByRole('row', { name: /VER.*350.*100%/ })).toBeVisible();
  await expect(fight.getByRole('row', { name: /LEC.*210.*Eliminated/ })).toBeVisible();
  await expect(fight.getByRole('img', { name: /title odds after each round/i })).toBeVisible();
});

test('the driver standings rank racecraft by net overtakes', async ({ page }) => {
  await page.goto('/drivers?year=2026');

  const table = page.getByRole('table', { name: 'Racecraft' });
  await expect(table.getByRole('row', { name: /LEC.*41.*22.*\+19/ })).toBeVisible();
});

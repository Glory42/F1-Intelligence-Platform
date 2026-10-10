import { test, expect } from '@playwright/test';

test('the constructors page ranks pit crews by median stop time', async ({ page }) => {
  await page.goto('/teams?year=2026');

  const table = page.getByRole('table', { name: 'Pit crew ranking' });
  await expect(table.getByRole('row', { name: /1.*Ferrari.*2\.31 s.*1\.98 s.*41/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /2.*Red Bull Racing.*2\.45 s/ })).toBeVisible();
});

test("the constructors page shows constructors' title odds", async ({ page }) => {
  await page.goto('/teams?year=2026');

  const table = page.getByRole('table', { name: "Constructors' title odds" });
  await expect(table.getByRole('row', { name: /Red Bull Racing.*81%/ })).toBeVisible();
});

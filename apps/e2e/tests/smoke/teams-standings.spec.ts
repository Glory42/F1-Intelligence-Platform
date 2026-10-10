import { test, expect, type Page } from '@playwright/test';

const views = (page: Page) => page.getByRole('navigation', { name: 'Teams views' });

test('the teams page leads with the standings and keeps the analysis in tabs', async ({ page }) => {
  await page.goto('/teams?year=2026');

  await expect(views(page).getByRole('link')).toHaveText(['Standings', 'Title odds', 'Pit crews']);
  await expect(views(page).getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Red Bull Racing').first()).toBeVisible();
  await expect(page.getByRole('table', { name: 'Pit crew ranking' })).toHaveCount(0);
});

test('the pit crews tab ranks crews by median stop time', async ({ page }) => {
  await page.goto('/teams?year=2026');
  await views(page).getByRole('link', { name: 'Pit crews' }).click();

  await expect(page).toHaveURL(/\/teams\?year=2026&tab=pit-crews$/);
  const table = page.getByRole('table', { name: 'Pit crew ranking' });
  await expect(table.getByRole('row', { name: /1.*Ferrari.*2\.31 s.*1\.98 s.*41/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /2.*Red Bull Racing.*2\.45 s/ })).toBeVisible();
});

test("the title odds tab shows constructors' title odds", async ({ page }) => {
  await page.goto('/teams?year=2026&tab=title-odds');

  const table = page.getByRole('table', { name: "Constructors' title odds" });
  await expect(table.getByRole('row', { name: /Red Bull Racing.*81%/ })).toBeVisible();
});

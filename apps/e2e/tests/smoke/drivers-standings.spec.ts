import { test, expect, type Page } from '@playwright/test';

const views = (page: Page) => page.getByRole('navigation', { name: 'Drivers views' });

test('the drivers page leads with the standings and keeps the analysis in tabs', async ({ page }) => {
  await page.goto('/drivers?year=2026');

  await expect(views(page).getByRole('link')).toHaveText(['Standings', 'Title fight', 'Racecraft']);
  await expect(views(page).getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Title fight' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Racecraft' })).toHaveCount(0);
});

test('the title fight tab shows title odds and who is mathematically out', async ({ page }) => {
  await page.goto('/drivers?year=2026&tab=title-fight');

  const fight = page.getByRole('region', { name: 'Title fight' });
  await expect(fight.getByRole('row', { name: /VER.*350.*100%/ })).toBeVisible();
  await expect(fight.getByRole('row', { name: /LEC.*210.*Eliminated/ })).toBeVisible();
  await expect(fight.getByRole('img', { name: /title odds after each round/i })).toBeVisible();
});

test('switching to the racecraft tab keeps the chosen season', async ({ page }) => {
  await page.goto('/drivers?year=2026');
  await views(page).getByRole('link', { name: 'Racecraft' }).click();

  await expect(page).toHaveURL(/\/drivers\?year=2026&tab=racecraft$/);
  const table = page.getByRole('table', { name: 'Racecraft' });
  await expect(table.getByRole('row', { name: /LEC.*41.*22.*\+19/ })).toBeVisible();
});

test('the page tab row never scrolls vertically', async ({ page }) => {
  await page.goto('/drivers?year=2026');

  const overflowY = await views(page).evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflowY).toBe(0);
});

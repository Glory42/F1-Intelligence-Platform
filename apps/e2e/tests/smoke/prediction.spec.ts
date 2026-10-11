import { test, expect, type Page } from '@playwright/test';

const views = (page: Page) => page.getByRole('navigation', { name: 'Predictions views' });

test('the predictions page leads with the upcoming pick and grades the model in a Scorecard tab', async ({ page }) => {
  const response = await page.goto('/prediction');
  expect(response?.status()).toBe(200);

  await expect(views(page).getByRole('link')).toHaveText(['Upcoming', 'Scorecard']);
  await expect(views(page).getByRole('link', { name: 'Upcoming' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scorecard' })).toHaveCount(0);
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});

test("the Scorecard grades the model's season race by race", async ({ page }) => {
  await page.goto('/prediction?tab=scorecard&year=2025');

  const scorecard = page.getByRole('region', { name: 'Scorecard' });
  await expect(scorecard.getByText('P1 hit', { exact: true }).locator('..')).toContainText('100%');
  await expect(scorecard.getByRole('list', { name: 'Race by race' }).getByRole('link', { name: /Italian Grand Prix/ })).toBeVisible();
});

test('the old season recap URL lands on that season’s Scorecard', async ({ page }) => {
  await page.goto('/prediction/recap/2025');

  await expect(page).toHaveURL(/\/prediction\?tab=scorecard&year=2025$/);
  await expect(page.getByRole('region', { name: 'Scorecard' })).toBeVisible();
});

test('the race prediction page explains long-run pace with the Friday ranking', async ({ page }) => {
  await page.goto('/prediction/1');

  const table = page.getByRole('table', { name: 'Friday long-run pace' });
  await expect(table.getByRole('row', { name: /LEC.*MEDIUM.*1:24\.120/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /VER.*HARD.*\+0\.230/ })).toBeVisible();
});

import { test, expect } from '@playwright/test';

test('renders team stats and drivers against fixture data', async ({ page }) => {
  const response = await page.goto('/teams/1?year=2026');
  expect(response?.status()).toBe(200);

  await expect(page.getByText('Red Bull Racing').first()).toBeVisible();
  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByText('Championship').first()).toBeVisible();

  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
  await expect(page.getByText('Team not found')).toHaveCount(0);
});

test('the team page leads with this season and keeps the rest in tabs', async ({ page }) => {
  await page.goto('/teams/1?year=2026');

  const views = page.getByRole('navigation', { name: 'Team views' });
  await expect(views.getByRole('link')).toHaveText(['This season', 'Pit crew', 'History']);
  await expect(views.getByRole('link', { name: 'This season' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Pit crew' })).toHaveCount(0);

  await views.getByRole('link', { name: 'Pit crew' }).click();
  await expect(page).toHaveURL(/\/teams\/1\?year=2026&tab=pit-crew$/);
  await expect(page.getByRole('region', { name: 'Pit crew' })).toBeVisible();
});

test("shows the team's pit crew median, best stop and season rank", async ({ page }) => {
  await page.goto('/teams/1?year=2026&tab=pit-crew');

  const crew = page.getByRole('region', { name: 'Pit crew' });
  await expect(crew.getByText('Median stop', { exact: true }).locator('..')).toContainText('2.45 s');
  await expect(crew.getByText('Best stop', { exact: true }).locator('..')).toContainText('2.04 s');
  await expect(crew.getByText('Crew rank', { exact: true }).locator('..')).toContainText('#2 of 2');
  await expect(crew.getByText('Gap to fastest').locator('..')).toContainText('+0.14 s');
});

test('the pit crew tab charts every stop, splits them by driver and ranks every crew', async ({ page }) => {
  await page.goto('/teams/1?year=2026&tab=pit-crew');

  const crew = page.getByRole('region', { name: 'Pit crew' });
  await expect(crew.getByRole('img', { name: /pit stop in 2026/ }).locator('circle')).toHaveCount(3);
  await expect(crew.getByRole('table', { name: 'Stops by driver' }).getByRole('row').nth(1)).toContainText('VER');
  const allCrews = crew.getByRole('table', { name: 'Pit crew ranking' });
  await expect(allCrews.getByRole('row')).toHaveCount(3);
  await expect(allCrews).toContainText('Ferrari');
});

test('the history tab is one season-by-season table with chassis and power unit', async ({ page }) => {
  await page.goto('/teams/1?year=2026&tab=history');

  const history = page.getByRole('region', { name: 'Team history' });
  await expect(history).toContainText('130 grand prix wins');
  const rows = history.getByRole('table', { name: 'Season by season' }).getByRole('row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('2026');
  await expect(rows.nth(1)).toContainText('RB22');
  await expect(rows.nth(2)).toContainText('RB21');
});

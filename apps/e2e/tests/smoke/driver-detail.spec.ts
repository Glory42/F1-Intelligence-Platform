import { test, expect } from '@playwright/test';

test('renders driver stats and recent results against fixture data', async ({ page }) => {
  const response = await page.goto('/drivers/10?year=2026');
  expect(response?.status()).toBe(200);

  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByText('Red Bull Racing').first()).toBeVisible();
  await expect(page.getByText('Championship').first()).toBeVisible();
  await expect(page.getByText('Italian Grand Prix').first()).toBeVisible();

  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
  await expect(page.getByText('Driver not found')).toHaveCount(0);
});

test('the driver page leads with this season and keeps the rest in tabs', async ({ page }) => {
  await page.goto('/drivers/10?year=2026');

  const views = page.getByRole('navigation', { name: 'Driver views' });
  await expect(views.getByRole('link')).toHaveText(['This season', 'Teammate battle', 'Career', 'Model']);
  await expect(views.getByRole('link', { name: 'This season' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Team-mate battle' })).toHaveCount(0);

  await views.getByRole('link', { name: 'Teammate battle' }).click();
  await expect(page).toHaveURL(/\/drivers\/10\?year=2026&tab=teammate$/);
  await expect(page.getByRole('region', { name: 'Team-mate battle' })).toBeVisible();
});

test('the driver page scores the team-mate head-to-head', async ({ page }) => {
  await page.goto('/drivers/10?year=2026&tab=teammate');

  const battle = page.getByRole('region', { name: 'Team-mate battle' });
  await expect(battle).toContainText('TSU');
  // Same head-to-head bars as the teams page: driver value | label | team-mate value.
  await expect(battle.getByText('Qualifying', { exact: true }).locator('..')).toContainText(/14\s*Qualifying\s*2/);
  await expect(battle.getByText('Race', { exact: true }).locator('..')).toContainText(/12\s*Race\s*1/);
  await expect(battle.getByText('GP points', { exact: true }).locator('..')).toContainText(/350\s*GP points\s*48/);
});

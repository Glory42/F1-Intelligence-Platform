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

test("shows the team's pit crew median, best stop and season rank", async ({ page }) => {
  await page.goto('/teams/1?year=2026');

  const crew = page.getByRole('region', { name: 'Pit crew' });
  await expect(crew.getByText('2.45 s')).toBeVisible();
  await expect(crew.getByText('2.04 s')).toBeVisible();
  await expect(crew.getByText('#2 of 2')).toBeVisible();
});

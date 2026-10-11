import { test, expect } from '@playwright/test';

test('renders both drivers season comparison from URL params against fixture data', async ({ page }) => {
  const response = await page.goto('/compare/drivers?year=2025&a=10&b=11');
  expect(response?.status()).toBe(200);

  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByText('Charles Leclerc').first()).toBeVisible();
  await expect(page.getByText('Championship Points').first()).toBeVisible();

  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});

test('compare switches between drivers and teams from one place', async ({ page }) => {
  await page.goto('/compare/drivers');

  const views = page.getByRole('navigation', { name: 'Compare views' });
  await expect(views.getByRole('link')).toHaveText(['Drivers', 'Teams']);
  await expect(views.getByRole('link', { name: 'Drivers' })).toHaveAttribute('aria-current', 'page');

  await views.getByRole('link', { name: 'Teams' }).click();
  // Once hydrated, the compare tool writes its default picks into the query string.
  await expect(page).toHaveURL(/\/compare\/teams(\?.*)?$/);
  await expect(page.getByRole('navigation', { name: 'Compare views' }).getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
});

import { test, expect, type Page } from '@playwright/test';

const seasonButton = (page: Page) => page.getByRole('button', { name: /^Season \d{4}: choose another$/ });

// The site navigates with Astro's client router: the menu must keep working on pages it swaps in,
// including one already seen this session (a cached copy of it used to come back with a dead menu).
test('the season menu opens on every page the client router swaps in', async ({ page }) => {
  await page.goto('/drivers?year=2025');
  await seasonButton(page).click();
  await expect(page.getByRole('link', { name: '2024', exact: true })).toBeVisible();

  await page.getByRole('link', { name: '2024', exact: true }).click();
  await expect(page).toHaveURL(/year=2024/);
  await seasonButton(page).click();
  await expect(page.getByRole('link', { name: '2025', exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/year=2025/);
  await seasonButton(page).click();
  await expect(page.getByRole('link', { name: '2024', exact: true })).toBeVisible();
});

test('a click outside closes the season menu', async ({ page }) => {
  await page.goto('/drivers?year=2025');
  await seasonButton(page).click();
  await expect(seasonButton(page)).toHaveAttribute('aria-expanded', 'true');

  await page.locator('main').click({ position: { x: 5, y: 5 } });

  await expect(seasonButton(page)).toHaveAttribute('aria-expanded', 'false');
});

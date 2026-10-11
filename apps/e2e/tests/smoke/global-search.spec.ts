import { test, expect } from '@playwright/test';

test('opens via keyboard shortcut, shows fixture results, and closes on Escape', async ({ page }) => {
  await page.goto('/');

  const searchInput = page.getByPlaceholder(/search drivers, teams, and circuits/i);
  await expect(searchInput).not.toBeVisible();

  // GlobalSearch is a `client:idle` island: on a cold dev server it can take a
  // few seconds to hydrate, so retry the shortcut until the palette responds.
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(searchInput).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByText('Ferrari').first()).toBeVisible();
  await expect(page.getByText('Autodromo Nazionale Monza').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(searchInput).not.toBeVisible();
});
